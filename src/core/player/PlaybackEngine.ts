import type { Song } from '../Dispatcher.js';
import { recordPlayFailure } from './PlaybackFailure.js';

export type LoopMode = 'off' | 'repeat' | 'queue';

/**
 * The playback model. Dispatcher owns the storage (its public fields are part
 * of the API used by events, commands and the dashboard); the engine mutates it
 * through this interface, so there is exactly one copy of every value.
 */
export interface PlaybackState {
    current: Song | null;
    queue: Song[];
    history: Song[];
    previous: Song | null;
    loop: LoopMode;
    autoplay: boolean;
    readonly volume: number;
    paused: boolean;
    stopped: boolean;
    seed: Song | null;
    seeds: Song[];
    pauseWhenEmpty: boolean;
    paused247: boolean;
    /** Failed final attempts per track, so an unplayable track is skipped. */
    failedTracks: Map<string, number>;
}

/** Narrow view of a Shoukaku player; adapters own the real object. */
export interface PlaybackPlayerPort {
    isAvailable(): boolean;
    play(track: Song): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    stop(): Promise<void>;
    setVolume(volume: number): Promise<void>;
    position(): number;
    volume(): number;
    isPaused(): boolean;
    hasTrack(): boolean;
}

export interface PlaybackSessionPort {
    save(snapshot: {
        guildId: string;
        textId: string;
        voiceId: string;
        current: Song | null;
        queue: Song[];
        position: number;
        loop: LoopMode;
        autoplay: boolean;
        volume: number;
        paused: boolean;
    }): Promise<void>;
    remove(guildId: string): Promise<void>;
}

export interface PlaybackLoggerPort {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

/** Everything the engine needs from its dispatcher besides playback state. */
export interface PlaybackHost {
    readonly guildId: string;
    /** A live dispatcher for this guild still exists. */
    readonly exists: boolean;
    /** The player's Lavalink session changed or the player was dropped. */
    readonly stale: boolean;
    /** Voice/text ids for the saved session, or null when persistence is off. */
    sessionTarget(): { textId: string; voiceId: string } | null;
    persist(): Promise<void>;
    /** setTimeout for retry backoff; injected so tests need no real waits. */
    scheduleRetry(delayMs: number, task: () => void): RetryHandle | null;
    /** Re-resolve a rejected encoded track by URI. */
    resolveFresh(track: Song): Promise<Song | null>;
    /** Start the queue head when nothing is current; used after a failure. */
    restartIfIdle(): void;
    /** 24/7 status and configured pause timeout for the current guild. */
    pausePolicy(): Promise<{ stay: boolean; seconds: number }>;
    armPauseTimeout(seconds: number, onElapsed: () => void): void;
    clearPauseTimeout(): void;
    destroy(): void;
}

/** A scheduled retry the engine can cancel when playback control changes. */
export interface RetryHandle {
    cancel(): void;
}

export interface PlaybackPorts {
    player: PlaybackPlayerPort;
    sessions: PlaybackSessionPort;
    logger: PlaybackLoggerPort;
    host: PlaybackHost;
}

/**
 * Owns playback transport decisions: which track starts, retry/backoff,
 * pause/resume policy, skip/seek/stop and 24/7 resume. It never talks to
 * Shoukaku, the database or the Discord client directly.
 */
export class PlaybackEngine {
    /** The single pending retry; stop/skip/pause/destroy cancel it. */
    private retry: RetryHandle | null = null;
    /**
     * Bumped whenever a transport action invalidates work that is already in
     * flight, so a retry scheduled before `/stop` cannot start audio after it.
     */
    private generation = 0;

    public constructor(
        private readonly state: PlaybackState,
        private readonly ports: PlaybackPorts
    ) {}

    /** Schedule a retry only if no control action happened in the meantime. */
    private scheduleRetry(delayMs: number, generation: number, task: () => void): void {
        this.cancelRetry();
        this.retry = this.ports.host.scheduleRetry(delayMs, () => {
            this.retry = null;
            if (generation !== this.generation) return;
            task();
        });
    }

    /** Drop a pending backoff timer; safe to call repeatedly. */
    public cancelRetry(): void {
        this.retry?.cancel();
        this.retry = null;
    }

    /** Teardown: nothing may start audio on a player that no longer exists. */
    public dispose(): void {
        this.cancelRetry();
        this.generation += 1;
    }

    /** A player action nobody awaits must not become an unhandled rejection. */
    private callPlayer(action: string, run: () => Promise<unknown>): void {
        void run().catch(error => {
            this.ports.logger.warn(
                `[queue] ${action} failed for ${this.guildId}: ${error}`
            );
        });
    }

    private get guildId(): string {
        return this.ports.host.guildId;
    }

    public async play(attempt: number = 1): Promise<void> {
        if (!this.ports.host.exists || (!this.state.queue.length && !this.state.current)) {
            return;
        }
        if (this.ports.host.stale) {
            this.ports.logger.warn(
                `[queue] refusing to play on a stale player for ${this.guildId} (node session changed)`
            );
            return;
        }

        this.state.paused247 = false;
        // Capture the control generation before any await: a stop/skip/pause
        // that lands while the player call is in flight must win over a retry.
        const generation = this.generation;
        // On a retry current is already the track that failed; shifting again
        // would skip it and play the next queue entry instead.
        if (!this.state.current && this.state.queue.length !== 0) {
            this.state.current = this.state.queue.shift() ?? null;
        }
        if (!this.state.current) return;

        try {
            await this.ports.player.play(this.state.current);
            const startedKey = this.state.current.info?.uri ?? this.state.current.encoded;
            this.state.failedTracks.delete(startedKey);
            void this.ports.host.persist();
            this.state.history.push(this.state.current);
            if (this.state.history.length > 100) this.state.history.shift();
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const detail = error as { status?: number; path?: string; error?: string };
            this.ports.logger.error(
                `[queue] play failed for ${this.guildId}: ${message}` +
                    (detail.status ? ` (status ${detail.status}, ${detail.path ?? '?'})` : '') +
                    (detail.error ? ` — ${detail.error}` : '')
            );

            // Encoded tracks can be rejected after a Lavalink restart ("missing
            // source manager" / version mismatch). Re-resolve by URI once and
            // retry with a fresh payload instead of leaving a dead current track
            // that makes isPlaying() believe playback is running.
            if (attempt <= 3 && this.state.current?.info?.uri) {
                const fresh = await this.ports.host.resolveFresh(this.state.current);
                if (fresh) this.state.current = fresh;
                // A freshly reconnected node may still be registering its source
                // managers, so retry with backoff instead of once immediately.
                this.scheduleRetry(3000 * attempt, generation, () => {
                    if (this.state.current) void this.play(attempt + 1);
                });
                return;
            }

            // Retry a failed track a bounded number of times, then drop it.
            // Requeueing an unplayable track forever blocks the whole queue.
            if (this.state.current) {
                const current = this.state.current;
                const failure = recordPlayFailure(current, this.state.failedTracks);
                if (failure.drop) {
                    this.ports.logger.warn(
                        `[queue] skipping unplayable track in ${this.guildId}: ${failure.key}`
                    );
                } else {
                    this.state.queue.unshift(current);
                }
            }
            this.state.current = null;
            void this.ports.host.persist();
            if (this.state.queue.length) {
                this.scheduleRetry(3000, generation, () => this.ports.host.restartIfIdle());
            }
        }
    }

    public pause(): void {
        if (!this.ports.player.isAvailable()) return;
        this.cancelRetry();
        this.generation += 1;
        if (!this.state.paused) {
            this.callPlayer('pause', () => this.ports.player.pause());
            this.state.paused = true;
        } else {
            this.callPlayer('resume', () => this.ports.player.resume());
            this.state.paused = false;
        }
        this.ports.host.clearPauseTimeout();
        if (this.state.paused) {
            void this.ports.host
                .pausePolicy()
                .then(({ stay, seconds }) => {
                    if (stay) return;
                    if (!Number.isFinite(seconds) || seconds <= 0 || !this.state.paused) return;
                    this.ports.host.armPauseTimeout(seconds, () => {
                        if (this.state.paused) this.ports.host.destroy();
                    });
                })
                .catch(() => {});
        }
        void this.ports.host.persist();
    }

    /** Drop queued entries so the requested skip lands on the right track. */
    public skip(skipto: number = 1): void {
        if (!this.ports.player.isAvailable()) return;
        // A pending retry belongs to the track being skipped, not the next one.
        this.cancelRetry();
        this.generation += 1;
        if (skipto > 1) {
            if (skipto > this.state.queue.length) {
                this.state.queue.length = 0;
            } else {
                this.state.queue.splice(0, skipto - 1);
            }
        }
        this.callPlayer('stop', () => this.ports.player.stop());
    }

    public seek(time: number): void {
        if (!this.ports.player.isAvailable()) return;
        this.callPlayer('seek', () => this.ports.player.seek(time));
    }

    public stop(): void {
        if (!this.ports.player.isAvailable()) return;
        // Clear transport ownership first: a retry from the track that was
        // playing must never restart audio or re-save the queue after /stop.
        this.cancelRetry();
        this.generation += 1;
        this.state.current = null;
        this.state.queue.length = 0;
        this.state.history = [];
        this.state.loop = 'off';
        this.state.autoplay = false;
        this.state.seed = null;
        this.state.seeds = [];
        this.state.stopped = true;
        void this.ports.sessions.remove(this.guildId);
        this.callPlayer('stop', () => this.ports.player.stop());
    }

    public previous(): void {
        if (!this.ports.player.isAvailable()) return;
        if (!this.state.previous) return;
        this.state.queue.unshift(this.state.previous);
        this.callPlayer('stop', () => this.ports.player.stop());
    }

    /** A listener joined a 24/7 session after it paused at track end. */
    public resume247(): void {
        this.state.pauseWhenEmpty = false;
        if (!this.state.paused247) return;
        this.state.paused247 = false;
        if (!this.state.queue.length && this.state.previous) {
            this.state.queue.unshift(this.state.previous);
        }
        if (this.state.queue.length) void this.play();
    }

    public shuffle(): void {
        const queue = this.state.queue;
        for (let i = queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue[i], queue[j]] = [queue[j], queue[i]];
        }
    }

    public async isPlaying(): Promise<void> {
        if (this.state.queue.length && !this.state.current && !this.ports.player.isPaused()) {
            await this.play();
        }
    }

    public setLoop(loop: LoopMode): void {
        this.state.loop = loop;
        void this.ports.host.persist();
    }

    /** Snapshot the live state so a crash or restart can resume it. */
    public async persist(): Promise<void> {
        const target = this.ports.host.sessionTarget();
        if (!target) return;
        try {
            await this.ports.sessions.save({
                guildId: this.guildId,
                textId: target.textId,
                voiceId: target.voiceId,
                current: this.state.current,
                queue: this.state.queue,
                position: this.ports.player.position(),
                loop: this.state.loop,
                autoplay: this.state.autoplay,
                volume: this.ports.player.volume(),
                paused: this.state.paused,
            });
        } catch (error) {
            this.ports.logger.error(`[session] persist failed for ${this.guildId}: ${error}`);
        }
    }
}
