/* eslint-disable @typescript-eslint/typedef */
import { ChannelType, Message, User } from 'discord.js';
import { LoadType, Node, Player, Track, TrackEndEvent, TrackExceptionEvent } from 'shoukaku';

import { isFinishedTrackReason } from '../lib/TrackEndReason.js';
import { BootstrapClient } from './index.js';
import { normalizeAuthor, trackKey, trackSignature } from './player/TrackIdentity.js';
import { PresentationRegistry } from './player/PresentationRegistry.js';
import { persistSession } from './player/SessionWriter.js';
import { PlaybackTimers } from './player/PlaybackTimers.js';
import { DeezerClient } from './player/DeezerClient.js';
import { AUTOPLAY_SEEDS, buildSeedCandidates, buildSeedPool } from './player/AutoplaySeeds.js';
import { findColdStart } from './player/AutoplayColdStart.js';
import { affinityWeight, type AutoplayAffinity, chooseFrom, pickForSeed } from './player/AutoplayPicker.js';
import type { SavedTrack } from './player/TrackCodec.js';

export { toSaved } from './player/TrackCodec.js';
export type { SavedTrack } from './player/TrackCodec.js';

/** Autoplay needs YouTube video ids to build a mix, so this prefix is fixed
 * rather than following config.searchEngine (which may be Deezer/Spotify). */
const YOUTUBE_SEARCH = 'ytmsearch';

/** A seed's YouTube mix is stable for a while; re-resolving it on every pick
 * costs a search + playlist load. Keep the bounded set small and short-lived. */
type MixCacheEntry = { at: number; tracks: Track[] };
const relatedTracksCache = new Map<string, MixCacheEntry>();
const AUTOPLAY_CACHE_LIMIT = 100;
const AUTOPLAY_MIX_TTL_MS = 10 * 60_000;
export class Song implements Track {
    encoded: string;
    info: {
        identifier: string;
        isSeekable: boolean;
        author: string;
        length: number;
        isStream: boolean;
        position: number;
        title: string;
        uri?: string;
        artworkUrl?: string;
        isrc?: string;
        sourceName: string;
        requester: User;
    };
    pluginInfo: unknown;
    /** True when the bot queued this itself (autoplay filler, not a user request). */
    public autoplay = false;

    constructor(track: Song | Track, user: User, autoplay = false) {
        if (!track) throw new Error('Track is not provided');
        this.encoded = track.encoded;
        this.autoplay = autoplay;
        this.info = {
            ...track.info,
            requester: user,
        };
    }
}
/** Rebuild a playable Song; the requester becomes whoever restored it. */
export function fromSaved(saved: SavedTrack, user: User): Song {
    return new Song(
        { encoded: saved.encoded, info: { ...saved.info, position: 0 }, pluginInfo: {} },
        user,
        saved.autoplay
    );
}

export interface NowPlayingCollector {
    stop(reason?: string): void;
}

export default class Dispatcher {
    private client: BootstrapClient;
    public guildId: string;
    public channelId: string;
    private timersStore?: PlaybackTimers;

    private get timers(): PlaybackTimers {
        return (this.timersStore ??= new PlaybackTimers());
    }

    private deezerStore?: DeezerClient;

    private get deezer(): DeezerClient {
        return (this.deezerStore ??= new DeezerClient());
    }

    /** Voice channel this dispatcher is bound to; needed for session restore. */
    public voiceId: string | null;
    public player: Player;
    public queue: Song[];
    public stopped: boolean;
    public previous: Song | null;
    public current: Song | null;
    public loop: 'off' | 'repeat' | 'queue';
    public node: Node;
    private readonly nodeSession: string | null;
    public paused: boolean;
    /** Position sampled when the node died/was abandoned, so the replacement
     * node resumes at that instant rather than after the switch delay. */
    public resumePosition: number | null = null;
    public filters: Array<string>;
    /** Last applied values for parametric filters (pitch/rate/speed). */
    public filterValues: Record<string, number> = {};
    public autoplay: boolean;
    /** Last track a user asked for; the newest lane in `seeds`. */
    public seed: Song | null;
    /** Recent explicit requests, newest first (max AUTOPLAY_SEEDS). */
    public seeds: Song[];
    private toppingUp = false;
    /** Failed final attempts per track, so an unplayable track is skipped. */
    private failedTracks = new Map<string, number>();
    /** Settles when the Shoukaku player teardown finishes; rebuilds await it. */
    private leavePromise: Promise<void> | null = null;
    public nowPlayingMessage: Message | null;
    public nowPlayingCollector: NowPlayingCollector | null;
    /** "Leave in …" prompt shown when the queue drains; cleared on leave/requeue. */
    public queueEmptyPrompt: Message | null;
    /** Ephemeral command responses that should expire with the current track. */
    private presentation?: PresentationRegistry;
    /** Set by /playleave: tear down the player when the queue drains. */
    public leaveOnEnd = false;
    /** 24/7 mode: pause at the end of the current track when the channel is empty. */
    public pauseWhenEmpty = false;
    public paused247 = false;
    public history: Song[] = [];
    /** Suppresses the periodic persist while a session restore is populating it. */
    public restoring = false;
    /** Set for the first track start after a restore so it is not recorded twice. */
    public skipRecentRecording = false;

    constructor(options: DispatcherOptions) {
        this.client = options.client;
        this.guildId = options.guildId;
        this.channelId = options.channelId;
        this.voiceId = options.voiceId ?? null;
        this.player = options.player;
        this.queue = [];
        this.stopped = false;
        this.previous = null;
        this.current = null;
        this.loop = 'off';
        this.node = options.node;
        this.nodeSession = options.node.sessionId;
        this.paused = false;
        this.filters = [];
        this.autoplay = false;
        this.seed = null;
        this.seeds = [];
        this.nowPlayingMessage = null;
        this.nowPlayingCollector = null;
        this.queueEmptyPrompt = null;
        this.timers.persist = setInterval(() => {
            // A paused player's position cannot change and pause() already wrote
            // the state. An idle dispatcher has no position or queue to save;
            // persisting it only rewrites/deletes the same row every 10s.
            if (!this.paused && (this.current || this.queue.length)) void this.persist();
        }, 10_000);
        this.timers.stats = setInterval(() => void this.sampleListeners(), 60_000);
        (this.timers.persist as unknown as { unref?: () => void }).unref?.();
        (this.timers.stats as unknown as { unref?: () => void }).unref?.();

        this.player
            .on('start', () =>
                this.client.shoukaku.emitPlayerEvent('trackStart', this.player, this.current, this)
            )
            .on('end', (data: TrackEndEvent) => {
                // FINISHED is the normal path; LOAD_FAILED/CLEANUP/STOPPED/REPLACED mean
                // Lavalink dropped the track, which used to be completely silent.
                if (data?.reason && !isFinishedTrackReason(data.reason))
                    this.client.logger.warn(
                        `Track ended with reason ${data.reason}: ${
                            this.current?.info?.title ?? 'unknown'
                        }`
                    );
                if (!this.queue.length)
                    this.client.shoukaku.emitPlayerEvent('queueEnd', this.player, this.current, this);
                this.client.shoukaku.emitPlayerEvent('trackEnd', this.player, this.current, this, data?.reason);
            })
            .on('stuck', () => this.client.shoukaku.emitPlayerEvent('trackStuck', this.player, this.current))
            .on('exception', (data: TrackExceptionEvent) => {
                this.client.logger.error(
                    `Track exception (${data?.exception?.severity ?? 'unknown'}): ${
                        data?.exception?.message ?? 'no message'
                    }${data?.exception?.cause ? ` — ${data.exception.cause}` : ''}`
                );
            })
            .on('closed', (...arr) => {
                this.client.shoukaku.emitPlayerEvent('socketClosed', this.player, ...arr);
            });
    }

    get exists(): boolean {
        return this.client.queue.has(this.guildId);
    }

    /** True when the player no longer belongs to a live Lavalink session:
     * the node restarted (new session id) or Shoukaku dropped the player.
     * Comparing object identity alone missed the common case — Shoukaku keeps
     * the player in its map after a reconnect with a null session, so calls
     * failed with "Session not found" instead of rebuilding. */
    get isStale(): boolean {
        if (this.client.shoukaku.players.get(this.guildId) !== this.player) return true;
        return this.node.sessionId === null || this.node.sessionId !== this.nodeSession;
    }
    get volume(): number {
        return this.player.volume;
    }
    /** Shoukaku's player methods return promises nobody awaits; a player on a
     * dead session would otherwise raise unhandled rejections for every click. */
    private callPlayer(action: string, run: () => Promise<unknown>): void {
        void run().catch(error => {
            this.client.logger.warn(`[queue] ${action} failed for ${this.guildId}: ${error}`);
        });
    }

    public async play(attempt: number = 1): Promise<void> {
        if (!this.exists || (!this.queue.length && !this.current)) {
            return;
        }
        if (this.isStale) {
            this.client.logger.warn(
                `[queue] refusing to play on a stale player for ${this.guildId} (node session changed)`
            );
            return;
        }

        this.paused247 = false;
        // On a retry current is already the track that failed; shifting again
        // would skip it and play the next queue entry instead.
        if (!this.current && this.queue.length !== 0) this.current = this.queue.shift() ?? null;
        if (!this.current) return;

        try {
            await this.player.playTrack({ track: { encoded: this.current.encoded } });
            const startedKey = this.current.info?.uri ?? this.current.encoded;
            this.failedTracks.delete(startedKey);
            void this.persist();
            this.history.push(this.current);
            if (this.history.length > 100) this.history.shift();
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const detail = error as { status?: number; path?: string; error?: string; trace?: string };
            this.client.logger.error(
                `[queue] play failed for ${this.guildId}: ${message}` +
                    (detail.status ? ` (status ${detail.status}, ${detail.path ?? '?'})` : '') +
                    (detail.error ? ` — ${detail.error}` : '')
            );

            // Encoded tracks can be rejected after a Lavalink restart ("missing
            // source manager" / version mismatch). Re-resolve by URI once and
            // retry with a fresh payload instead of leaving a dead current track
            // that makes isPlaying() believe playback is running.
            if (attempt <= 3 && this.current?.info?.uri) {
                const fresh = await this.resolveFresh(this.current);
                if (fresh) this.current = fresh;
                // A freshly reconnected node may still be registering its source
                // managers, so retry with backoff instead of once immediately.
                setTimeout(() => {
                    if (this.current) void this.play(attempt + 1);
                }, 3000 * attempt);
                return;
            }

            // Retry a failed track a bounded number of times, then drop it.
            // Requeueing an unplayable track forever blocks the whole queue.
            if (this.current) {
                const key = this.current.info?.uri ?? this.current.encoded;
                const failures = (this.failedTracks.get(key) ?? 0) + 1;
                if (failures >= 3) {
                    this.failedTracks.delete(key);
                    this.client.logger.warn(`[queue] skipping unplayable track in ${this.guildId}: ${key}`);
                } else {
                    this.failedTracks.set(key, failures);
                    this.queue.unshift(this.current);
                }
            }
            this.current = null;
            void this.persist();
            if (this.queue.length) setTimeout(() => void this.isPlaying(), 3000);
        }
    }

    /** Re-resolve a saved track so its encoded payload matches this node. */
    private async resolveFresh(track: Song): Promise<Song | null> {
        const uri = track.info?.uri;
        const requester = track.info?.requester;
        if (!uri || !requester) return null;
        try {
            const res = await this.node.rest.resolve(uri);
            if (!res) return null;
            if (res.loadType === LoadType.TRACK) return this.buildTrack(res.data, requester);
            if (res.loadType === LoadType.SEARCH && res.data.length)
                return this.buildTrack(res.data[0], requester);
        } catch (error) {
            this.client.logger.warn(`[queue] could not re-resolve ${uri}: ${error}`);
        }
        return null;
    }

    public pause(): void {
        if (!this.player) return;
        if (!this.paused) {
            this.callPlayer('pause', () => this.player.setPaused(true));
            this.paused = true;
        } else {
            this.callPlayer('resume', () => this.player.setPaused(false));
            this.paused = false;
        }
        if (this.timers.pause) {
            clearTimeout(this.timers.pause);
            this.timers.pause = null;
        }
        if (this.paused) {
            void this.client.db
                .get_247(this.guildId)
                .then(stay => {
                    if (stay) return;
                    return this.client.db.getGuildSettings(this.guildId).then(settings => {
                        const seconds = Number(settings.timeoutpause ?? 0);
                        if (!Number.isFinite(seconds) || seconds <= 0 || !this.paused) return;
                        this.timers.pause = setTimeout(() => {
                            if (this.paused) this.destroy();
                        }, seconds * 1000);
                        (this.timers.pause as unknown as { unref?: () => void }).unref?.();
                    });
                })
                .catch(() => {});
        }
        void this.persist();
    }
    public remove(index: number): void {
        if (!this.player) return;
        if (index > this.queue.length) return;
        this.queue.splice(index, 1);
    }

    /** Round-robin queued tracks by requester so one user cannot occupy the
     * next N slots. Returns the number of tracks reordered. */
    public fairPlay(): number {
        if (!this.queue.length) return 0;
        const groups = new Map<string, Song[]>();
        for (const track of this.queue) {
            const requester = track.info.requester as { id?: string } | undefined;
            const key = requester?.id ?? 'unknown';
            const group = groups.get(key);
            if (group) group.push(track);
            else groups.set(key, [track]);
        }

        // Index cursors avoid repeatedly shifting arrays (O(n) instead of
        // O(n^2) for a long queue) while preserving requester round-robin.
        const lanes = [...groups.values()];
        const cursors = lanes.map((): number => 0);
        const fair: Song[] = [];
        let added = 0;
        while (added < this.queue.length) {
            for (let lane = 0; lane < lanes.length; lane++) {
                const next = lanes[lane][cursors[lane]++];
                if (!next) continue;
                fair.push(next);
                added++;
            }
        }
        this.queue = fair;
        void this.persist();
        return added;
    }
    public previousTrack(): void {
        if (!this.player) return;
        if (!this.previous) return;
        this.queue.unshift(this.previous);
        this.callPlayer('stop', () => this.player.stopTrack());
    }
    /** A listener joined a 24/7 session after it paused at track end. */
    public resume247(): void {
        this.pauseWhenEmpty = false;
        if (!this.paused247) return;
        this.paused247 = false;
        if (!this.queue.length && this.previous) this.queue.unshift(this.previous);
        if (this.queue.length) void this.play();
    }

    /** Sample voice membership once a minute for listener-time statistics. */
    private async sampleListeners(): Promise<void> {
        if (this.paused || this.paused247) return;
        const guild = this.client.guilds.cache.get(this.guildId);
        const channel = guild && this.voiceId ? guild.channels.cache.get(this.voiceId) : null;
        if (!guild || !channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) return;
        const rows = [...channel.members.filter(member => !member.user.bot).values()].map(member => ({
            userId: member.id,
            seconds: 60,
            deafSeconds: member.voice.deaf || member.voice.selfDeaf ? 60 : 0,
        }));
        await this.client.db.recordListenerStatsBulk(this.guildId, rows).catch(() => {});
    }

    public armIdleTimeout(seconds: number): void {
        this.clearIdleTimeout();
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        this.timers.idle = setTimeout(() => {
            this.timers.idle = null;
            if (!this.queue.length && !this.autoplay && !this.current) this.destroy();
        }, seconds * 1000);
        (this.timers.idle as unknown as { unref?: () => void }).unref?.();
    }

    public clearIdleTimeout(): void {
        if (this.timers.idle) clearTimeout(this.timers.idle);
        this.timers.idle = null;
    }

    /** Remove the "leave in …" prompt when playback resumes or the player goes away. */
    public clearQueueEmptyPrompt(): void {
        const prompt = this.queueEmptyPrompt;
        this.queueEmptyPrompt = null;
        if (prompt) void prompt.delete().catch(() => {});
    }

    public registerNowPlayingMessage(message: Message, durationMs: number | null): void {
        (this.presentation ??= new PresentationRegistry()).register(message, durationMs);
    }

    public hasTrackScopedNowPlayingMessage(messageId: string): boolean {
        return this.presentation?.has(messageId) ?? false;
    }

    public clearNowPlayingCommandMessages(): void {
        this.presentation?.clear();
    }

    public destroy(preserveSession: boolean = false): void {
        // A delayed timer or collector may still hold the old dispatcher after
        // a rebuild installed a replacement; never tear down the live player.
        if (this.client.queue.get(this.guildId) !== this) {
            if (this.timers.persist) clearInterval(this.timers.persist);
            this.timers.persist = null;
            if (this.timers.stats) clearInterval(this.timers.stats);
            this.timers.stats = null;
            if (this.timers.pause) clearTimeout(this.timers.pause);
            this.timers.pause = null;
            this.clearIdleTimeout();
            this.nowPlayingCollector?.stop('destroy');
            this.nowPlayingCollector = null;
            this.clearNowPlayingCommandMessages();
            this.clearQueueEmptyPrompt();
            return;
        }
        if (this.client.shuttingDown) {
            if (this.timers.persist) clearInterval(this.timers.persist);
            this.timers.persist = null;
            if (this.timers.stats) clearInterval(this.timers.stats);
            this.timers.stats = null;
            this.clearQueueEmptyPrompt();
            return;
        }
        if (this.timers.persist) clearInterval(this.timers.persist);
        this.timers.persist = null;
        if (this.timers.stats) clearInterval(this.timers.stats);
        this.timers.stats = null;
        if (this.timers.pause) clearTimeout(this.timers.pause);
        this.timers.pause = null;
        this.clearIdleTimeout();
        this.nowPlayingCollector?.stop('destroy');
        this.nowPlayingCollector = null;
        this.clearNowPlayingCommandMessages();
        this.clearQueueEmptyPrompt();
        if (!preserveSession) void this.client.db.deleteSession(this.guildId).catch(() => {});
        this.queue.length = 0;
        this.history = [];
        this.pauseWhenEmpty = false;
        this.paused247 = false;
        this.leavePromise = (async () => {
            try {
                await this.client.shoukaku.leaveVoiceChannel(this.guildId);
            } catch (error) {
                this.client.logger.warn(`[player] leave failed for ${this.guildId}: ${error}`);
            }
        })();
        this.client.queue.delete(this.guildId);
        this.client.utils.updateStatus(this.client, this.guildId);
        if (this.stopped) return;
        this.client.shoukaku.emitPlayerEvent('playerDestroy', this.player);
    }

    /**
     * Destroy and wait for Lavalink to remove the old player. A rebuild that
     * joins before this settles can have its new player deleted by the old
     * leave request, leaving the queue populated but silent.
     */
    public async destroyAndWait(preserveSession: boolean = false): Promise<void> {
        this.destroy(preserveSession);
        await this.leavePromise;
    }
    public setShuffle(): void {
        if (!this.player) return;
        const queue = this.queue;
        for (let i = queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue[i], queue[j]] = [queue[j], queue[i]];
        }
        this.queue = queue;
    }
    public async skip(skipto = 1): Promise<void> {
        if (!this.player) return;
        if (skipto > 1) {
            if (skipto > this.queue.length) {
                this.queue.length = 0;
            } else {
                this.queue.splice(0, skipto - 1);
            }
        }
        this.callPlayer('stop', () => this.player.stopTrack());
    }
    public seek(time: number): void {
        if (!this.player) return;
        this.callPlayer('seek', () => this.player.seekTo(time));
    }
    public stop(): void {
        if (!this.player) return;
        this.queue.length = 0;
        this.history = [];
        this.loop = 'off';
        this.autoplay = false;
        this.seed = null;
        this.seeds = [];
        this.stopped = true;
        void this.client.db.deleteSession(this.guildId).catch(() => {});
        this.callPlayer('stop', () => this.player.stopTrack());
    }
    /**
     * Snapshot playback state so a crash or restart can resume it. The row is
     * deleted when playback ends normally, so a later boot has nothing stale.
     */
    public async persist(): Promise<void> {
        if (!this.voiceId || this.restoring) return;
        try {
            await persistSession(this.client.db, {
                guildId: this.guildId,
                textId: this.channelId,
                voiceId: this.voiceId,
                current: this.current,
                queue: this.queue,
                position: this.player.position,
                loop: this.loop,
                autoplay: this.autoplay,
                volume: this.player.volume,
                paused: this.paused,
            });
        } catch (error) {
            this.client.logger.error(`[session] persist failed for ${this.guildId}: ${error}`);
        }
    }

    public setLoop(loop: 'off' | 'repeat' | 'queue'): void {
        this.loop = loop;
        void this.persist();
    }

    public buildTrack(track: Song | Track, user: User): Song {
        return new Song(track, user);
    }
    public async isPlaying(): Promise<void> {
        if (this.queue.length && !this.current && !this.player.paused) {
            this.play();
        }
    }
    /**
     * Queue a track a user asked for. Anything autoplay guessed is dropped
     * first: once someone requests music, the bot's filler is obsolete, and the
     * request becomes the seed for future picks.
     */
    public enqueue(song: Song, remember = true, persist = true): void {
        this.clearIdleTimeout();
        this.clearQueueEmptyPrompt();
        if (this.autoplay) this.purgeAutoplay();
        this.queue.push(song);
        if (remember) this.rememberSeed(song);
        if (persist) void this.persist();
        void this.ensureLookahead().catch(() => {});
    }

    /** Same contract as enqueue(), but jumps the queue (used by /playnext). */
    public enqueueNext(song: Song, remember = true, persist = true): void {
        this.clearIdleTimeout();
        this.clearQueueEmptyPrompt();
        if (this.autoplay) this.purgeAutoplay();
        this.queue.unshift(song);
        if (remember) this.rememberSeed(song);
        if (persist) void this.persist();
        void this.ensureLookahead().catch(() => {});
    }

    /** A playlist request contributes up to three random, distinct seed lanes.
     * Favor different artists first (a playlist often repeats one act), then
     * fill remaining slots with other unique tracks. */
    public seedPlaylist(tracks: Song[]): void {
        const unique: Song[] = [];
        const seenTracks = new Set<string>();
        const seenArtists = new Set<string>();
        const leftovers: Song[] = [];
        for (const track of this.shuffle(tracks)) {
            const signature = trackSignature(track) || trackKey(track);
            const key = trackKey(track);
            if (!signature || seenTracks.has(`s:${signature}`)) continue;
            if (key && seenTracks.has(`k:${key}`)) continue;
            seenTracks.add(`s:${signature}`);
            if (key) seenTracks.add(`k:${key}`);
            const artist = normalizeAuthor(track.info?.author) || signature;
            if (!seenArtists.has(artist) && unique.length < AUTOPLAY_SEEDS) {
                seenArtists.add(artist);
                unique.push(track);
            } else {
                leftovers.push(track);
            }
        }
        for (const track of leftovers) {
            if (unique.length >= AUTOPLAY_SEEDS) break;
            unique.push(track);
        }
        if (!unique.length) return;
        this.seeds = unique;
        this.seed = unique[0];
        void this.persist();
    }

    /** Add an explicit request to the seed pool, newest first, without
     * duplicates and without letting an old request fall off the front. */
    private rememberSeed(song: Song): void {
        this.seed = song;
        const signature = trackSignature(song);
        this.seeds = [
            song,
            ...this.seeds.filter(
                existing =>
                    trackSignature(existing) !== signature &&
                    trackKey(existing) !== trackKey(song)
            ),
        ].slice(0, AUTOPLAY_SEEDS);
    }

    /**
     * Keep exactly one bot pick queued ahead while autoplay is on, so /skip
     * always has somewhere to go. User requests keep precedence: nothing is
     * added while any track is already queued (a user track outranks the bot,
     * and an existing bot pick already satisfies the lookahead).
     */
    public async ensureLookahead(): Promise<Song | null> {
        if (!this.autoplay || this.toppingUp || this.queue.length) return null;
        this.toppingUp = true;
        try {
            // Do not seed from the track that happens to be current: with the
            // explicit seed first, a long session follows the last bot pick
            // instead of the user's request pool.
            return await this.Autoplay();
        } finally {
            this.toppingUp = false;
        }
    }

    /** Drop every bot-queued track. Returns how many were removed. */
    public purgeAutoplay(): number {
        const before = this.queue.length;
        this.queue = this.queue.filter(track => !track.autoplay);
        void this.persist();
        return before - this.queue.length;
    }

    private shuffle<T>(items: T[]): T[] {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    /** Already current, queued, or heard in the recent past? */
    private isRecent(track: Song | Track): boolean {
        const key = trackKey(track);
        const signature = trackSignature(track);
        if (!key && !signature) return false;
        const matches = (candidate: Song | Track): boolean =>
            (Boolean(key) && trackKey(candidate) === key) ||
            (Boolean(signature) && trackSignature(candidate) === signature);
        if (this.current && matches(this.current)) return true;
        if (this.queue.some(matches)) return true;
        return this.history.slice(-15).some(matches);
    }


    private affinityWeight(track: Track, affinity: AutoplayAffinity): number {
        return affinityWeight(track, affinity);
    }

    private chooseFrom(tracks: Track[], affinity?: AutoplayAffinity): Song | null {
        return chooseFrom(tracks, affinity, {
            history: this.history,
            botUser: this.client.user,
            isRecent: track => this.isRecent(track),
            buildTrack: (track, user) => this.buildTrack(track, user),
        });
    }

    /** Search a free-text query and pick one result. */
    private async pickFromQuery(query: string): Promise<Song | null> {
        return this.chooseFrom(
            await this.resolveTracks(`${this.client.config.searchEngine}:${query}`)
        );
    }

    /** Cold-start seed from Deezer's chart, filtered to non-explicit tracks. */
    private async chartSeed(): Promise<Song | null> {
        if (!this.node || !this.client.user) return null;
        const tracks = await this.deezer.chart();
        if (!tracks.length) return null;
        for (const candidate of this.shuffle(tracks).slice(0, 6)) {
            if (!candidate.link) continue;
            const resolved = await this.node.rest.resolve(candidate.link).catch(() => null);
            if (resolved?.loadType === LoadType.TRACK) {
                return this.buildTrack(resolved.data, this.client.user);
            }
        }
        return null;
    }

    /** Try curated cold-start queries in random order. */
    private async curatedSeed(seeds: string[]): Promise<Song | null> {
        for (const query of this.shuffle(seeds)) {
            const pick = await this.pickFromQuery(query);
            if (pick) return pick;
        }
        return null;
    }

    /** Resolve an identifier to a plain track list ([] on any failure). */
    private async resolveTracks(identifier: string): Promise<Track[]> {
        const resolve = await this.node?.rest.resolve(identifier).catch(() => null);
        return Array.isArray(resolve?.data) ? resolve.data : [];
    }

    /** YouTube id for a track. The lookup deliberately uses a YouTube prefix
     * rather than config.searchEngine: with a Deezer/Spotify engine configured,
     * searching it for a video id returns none, the mix never resolves, and
     * autoplay stays pinned to the seed artist. */
    private async youtubeIdFor(song: Song): Promise<string | null> {
        const looksLikeId = (value?: string): boolean => Boolean(value && /^[\w-]{11}$/.test(value));
        if (song.info.sourceName === 'youtube' && looksLikeId(song.info.identifier)) {
            return song.info.identifier;
        }
        const resolve = await this.node?.rest
            .resolve(`${YOUTUBE_SEARCH}:${song.info.title} ${song.info.author}`)
            .catch(() => null);
        const data = resolve?.data;
        if (!Array.isArray(data)) return null;
        const match = data.find(
            track => track.info?.sourceName === 'youtube' && looksLikeId(track.info?.identifier)
        );
        return match?.info?.identifier ?? null;
    }

    /** YouTube's mix for a seed track — the only source here that spans
     * artists; an artist search returns the same name over and over. */
    private async relatedTracks(seed: Song): Promise<Track[]> {
        const key = trackKey(seed);
        const cached = key ? relatedTracksCache.get(key) : undefined;
        if (cached && Date.now() - cached.at < AUTOPLAY_MIX_TTL_MS) return cached.tracks;

        const id = await this.youtubeIdFor(seed);
        if (!id) return [];
        const resolve = await this.node?.rest
            .resolve(`https://www.youtube.com/watch?v=${id}&list=RD${id}`)
            .catch(() => null);
        if (!resolve || resolve.loadType !== LoadType.PLAYLIST) return [];
        const playlist = resolve.data as { tracks?: Track[] };
        const tracks = playlist.tracks ?? [];
        if (key && tracks.length) {
            if (relatedTracksCache.size >= AUTOPLAY_CACHE_LIMIT) {
                const oldest = relatedTracksCache.keys().next().value;
                if (oldest) relatedTracksCache.delete(oldest);
            }
            relatedTracksCache.set(key, { at: Date.now(), tracks });
        }
        return tracks;
    }

    private async pickForSeed(seed: Song): Promise<Song | null> {
        return await pickForSeed(seed, {
            relatedTracks: trackSeed => this.relatedTracks(trackSeed),
            relatedArtistNames: trackSeed => this.relatedArtistNames(trackSeed),
            pickFromQuery: query => this.pickFromQuery(query),
            chooseFrom: (tracks, affinity) => this.chooseFrom(tracks, affinity),
            shuffle: items => this.shuffle(items),
        });
    }

    /** Kept as a seam for picker tests; the HTTP/cache work lives in DeezerClient. */
    private async relatedArtistNames(song: Song): Promise<string[]> {
        return await this.deezer.relatedArtists(song);
    }

    private seedPool(): Song[] {
        return buildSeedPool(this);
    }

    private seedCandidates(explicit?: Song): Song[] {
        return buildSeedCandidates(this, explicit, items => this.shuffle(items));
    }

    /**
     * Seed explicitly from one or more comma-separated queries
     * ("/autoplay Akon, NF"): queue one random result from the first query,
     * add each result to the seed pool, and start playing if idle.
     */
    public async seedFrom(query: string | string[]): Promise<Song | null> {
        this.purgeAutoplay();
        const parts = Array.isArray(query) ? query : [query];
        const queries = parts
            .flatMap(part => part.split(','))
            .map(part => part.trim())
            .filter(Boolean)
            .slice(0, AUTOPLAY_SEEDS);
        const picks: Song[] = [];
        for (const part of queries) {
            const pick = await this.pickFromQuery(part);
            if (!pick) continue;
            pick.autoplay = true;
            picks.push(pick);
        }
        if (!picks.length) return null;
        // Add in reverse so the first query remains the newest lane.
        for (const pick of [...picks].reverse()) this.rememberSeed(pick);
        const opener = picks[0];
        this.queue.push(opener);
        await this.isPlaying();
        return opener;
    }

    private async queueAutoplay(pick: Song): Promise<Song> {
        pick.autoplay = true;
        this.queue.push(pick);
        await this.isPlaying();
        return pick;
    }

    /**
     * Queue exactly one bot pick. Returns it, or null when no seed yields
     * anything usable — a failed pick must never take the player down.
     */
    public async Autoplay(explicit?: Song): Promise<Song | null> {
        for (const seed of this.seedCandidates(explicit)) {
            const pick = await this.pickForSeed(seed);
            if (pick) return await this.queueAutoplay(pick);
        }
        // Cold start: nothing has played and no seed was requested.
        const cold = await findColdStart({
            getConfig: () => this.client.db.getAutoplaySetting(this.guildId),
            config: this.client.config,
            chartSeed: () => this.chartSeed(),
            curatedSeed: seeds => this.curatedSeed(seeds),
            pickFromQuery: query => this.pickFromQuery(query),
        });
        if (cold) return await this.queueAutoplay(cold);
        this.client.logger.error(`[autoplay] no usable track found for guild ${this.guildId}`);
        return null;
    }

    public async setAutoplay(autoplay: boolean): Promise<Song | null> {
        this.autoplay = autoplay;
        void this.persist();
        if (!autoplay) {
            this.purgeAutoplay();
            return null;
        }
        // Nothing to play at all: seed the first track. Otherwise just make
        // sure one pick is waiting behind whatever is queued.
        if (!this.current && !this.queue.length) return await this.Autoplay();
        return await this.ensureLookahead();
    }
}

export interface DispatcherOptions {
    client: BootstrapClient;
    guildId: string;
    channelId: string;
    voiceId?: string;
    player: Player;
    node: Node;
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
