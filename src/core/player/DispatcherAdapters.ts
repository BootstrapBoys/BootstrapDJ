import type BootstrapClient from '../BootstrapClient.js';
import type Dispatcher from '../Dispatcher.js';
import type { Song } from '../Dispatcher.js';
import type { DestroyHost } from './DestroyCoordinator.js';
import type { PlaybackHost, PlaybackState } from './PlaybackEngine.js';
import type { PlaybackTimers } from './PlaybackTimers.js';

/** Guild settings the pause policy needs; structural so any store fits. */
interface PauseSettingsStore {
    get_247(guildId: string): Promise<unknown>;
    getGuildSettings(guildId: string): Promise<{ timeoutpause?: unknown }>;
}

/** Timer hooks owned by the destroy coordinator, exposed as a port. */
interface PauseTimeoutPort {
    arm(seconds: number, onElapsed: () => void): void;
    clear(): void;
}

/**
 * Playback state backed by the dispatcher's own fields. Commands, events, the
 * dashboard and tests read those fields directly, so the engine must mutate
 * the same objects instead of keeping a parallel copy.
 */
export class DispatcherPlaybackState implements PlaybackState {
    public constructor(private readonly dispatcher: Dispatcher) {}

    public get current(): Song | null {
        return this.dispatcher.current;
    }

    public set current(value: Song | null) {
        this.dispatcher.current = value;
    }

    public get queue(): Song[] {
        return this.dispatcher.queue;
    }

    public set queue(value: Song[]) {
        this.dispatcher.queue = value;
    }

    public get history(): Song[] {
        return this.dispatcher.history;
    }

    public set history(value: Song[]) {
        this.dispatcher.history = value;
    }

    public get previous(): Song | null {
        return this.dispatcher.previous;
    }

    public set previous(value: Song | null) {
        this.dispatcher.previous = value;
    }

    public get loop(): 'off' | 'repeat' | 'queue' {
        return this.dispatcher.loop;
    }

    public set loop(value: 'off' | 'repeat' | 'queue') {
        this.dispatcher.loop = value;
    }

    public get autoplay(): boolean {
        return this.dispatcher.autoplay;
    }

    public set autoplay(value: boolean) {
        this.dispatcher.autoplay = value;
    }

    public get volume(): number {
        return this.dispatcher.player?.volume ?? 0;
    }

    public get paused(): boolean {
        return this.dispatcher.paused;
    }

    public set paused(value: boolean) {
        this.dispatcher.paused = value;
    }

    public get stopped(): boolean {
        return this.dispatcher.stopped;
    }

    public set stopped(value: boolean) {
        this.dispatcher.stopped = value;
    }

    public get seed(): Song | null {
        return this.dispatcher.seed;
    }

    public set seed(value: Song | null) {
        this.dispatcher.seed = value;
    }

    public get seeds(): Song[] {
        return this.dispatcher.seeds;
    }

    public set seeds(value: Song[]) {
        this.dispatcher.seeds = value;
    }

    public get pauseWhenEmpty(): boolean {
        return this.dispatcher.pauseWhenEmpty;
    }

    public set pauseWhenEmpty(value: boolean) {
        this.dispatcher.pauseWhenEmpty = value;
    }

    public get paused247(): boolean {
        return this.dispatcher.paused247;
    }

    public set paused247(value: boolean) {
        this.dispatcher.paused247 = value;
    }

    public get failedTracks(): Map<string, number> {
        return this.dispatcher.failedTracks;
    }
}

/** Everything the engine needs from the dispatcher besides playback state. */
export class DispatcherPlaybackHost implements PlaybackHost {
    public constructor(
        private readonly dispatcher: Dispatcher,
        private readonly settings: PauseSettingsStore,
        private readonly pauseTimeouts: PauseTimeoutPort
    ) {}

    public get guildId(): string {
        return this.dispatcher.guildId;
    }

    public get exists(): boolean {
        return this.dispatcher.exists;
    }

    public get stale(): boolean {
        return this.dispatcher.isStale;
    }

    public sessionTarget(): { textId: string; voiceId: string } | null {
        const { channelId, voiceId, restoring } = this.dispatcher;
        if (!voiceId || restoring) return null;
        return { textId: channelId, voiceId };
    }

    public persist(): Promise<void> {
        return this.dispatcher.persist();
    }

    public scheduleRetry(delayMs: number, task: () => void): void {
        setTimeout(task, delayMs);
    }

    public resolveFresh(track: Song): Promise<Song | null> {
        return this.dispatcher.resolveFresh(track);
    }

    public restartIfIdle(): void {
        void this.dispatcher.isPlaying();
    }

    public async pausePolicy(): Promise<{ stay: boolean; seconds: number }> {
        const stay = await this.settings.get_247(this.dispatcher.guildId);
        if (stay) return { stay: true, seconds: 0 };
        const settings = await this.settings.getGuildSettings(this.dispatcher.guildId);
        return { stay: false, seconds: Number(settings.timeoutpause ?? 0) };
    }

    public armPauseTimeout(seconds: number, onElapsed: () => void): void {
        this.pauseTimeouts.arm(seconds, onElapsed);
    }

    public clearPauseTimeout(): void {
        this.pauseTimeouts.clear();
    }

    public destroy(): void {
        this.dispatcher.destroy();
    }
}

/** Teardown view over the dispatcher; the coordinator owns the ordering. */
export class DispatcherDestroyHost implements DestroyHost {
    public constructor(
        private readonly dispatcher: Dispatcher,
        public readonly timers: PlaybackTimers,
        private readonly client: BootstrapClient
    ) {}

    public get guildId(): string {
        return this.dispatcher.guildId;
    }

    public get stopped(): boolean {
        return this.dispatcher.stopped;
    }

    public isCurrent(): boolean {
        return this.client.queue.get(this.dispatcher.guildId) === this.dispatcher;
    }

    public isShuttingDown(): boolean {
        return this.client.shuttingDown;
    }

    public isIdle(): boolean {
        const { current, queue, autoplay } = this.dispatcher;
        return !current && !queue.length && !autoplay;
    }

    public stopNowPlayingCollector(): void {
        this.dispatcher.nowPlayingCollector?.stop('destroy');
        this.dispatcher.nowPlayingCollector = null;
    }

    public clearNowPlayingCommandMessages(): void {
        this.dispatcher.clearNowPlayingCommandMessages();
    }

    public clearQueueEmptyPrompt(): void {
        this.dispatcher.clearQueueEmptyPrompt();
    }

    public resetPlayback(): void {
        this.dispatcher.queue.length = 0;
        this.dispatcher.history = [];
        this.dispatcher.pauseWhenEmpty = false;
        this.dispatcher.paused247 = false;
    }

    public deleteSession(): Promise<void> {
        return this.dispatcher.deleteSession();
    }

    public leave(): Promise<void> {
        return this.client.shoukaku.leaveVoiceChannel(this.dispatcher.guildId);
    }

    public removeFromQueue(): void {
        this.client.queue.delete(this.dispatcher.guildId);
    }

    public updateStatus(): void {
        this.client.utils.updateStatus(this.client, this.dispatcher.guildId);
    }

    public emitPlayerDestroy(): void {
        this.client.shoukaku.emitPlayerEvent('playerDestroy', this.dispatcher.player);
    }
}
