/* eslint-disable @typescript-eslint/typedef */
import { ChannelType, Message, User } from 'discord.js';
import { LoadType, Node, Player, Track, TrackEndEvent, TrackExceptionEvent } from 'shoukaku';

import { isFinishedTrackReason } from '../lib/TrackEndReason.js';
import { BootstrapClient } from './index.js';
import { PresentationRegistry } from './player/PresentationRegistry.js';
import { PlaybackTimers } from './player/PlaybackTimers.js';
import {
    PlaybackEngine,
    type PlaybackHost,
    type PlaybackState,
} from './player/PlaybackEngine.js';
import { ShoukakuPlayerPort } from './player/ShoukakuPlayerPort.js';
import { SessionPort } from './player/SessionPort.js';
import { DispatcherLoggerPort } from './player/DispatcherLoggerPort.js';
import { DestroyCoordinator, type DestroyHost } from './player/DestroyCoordinator.js';
import { DeezerClient } from './player/DeezerClient.js';
import { AUTOPLAY_SEEDS, buildSeedCandidates, buildSeedPool } from './player/AutoplaySeeds.js';
import { findColdStart } from './player/AutoplayColdStart.js';
import { relatedTracks as getRelatedTracks } from './player/YouTubeMix.js';
import { affinityWeight, type AutoplayAffinity, chooseFrom, pickForSeed } from './player/AutoplayPicker.js';
import { isRecent as checkRecent, youtubeIdFor as findYouTubeId, resolveFresh as freshTrack, resolveTracks as resolveIdentifier } from './player/TrackResolution.js';
import { fairPlayQueue, playlistSeeds, purgeAutoplayQueue, rememberSeedState } from './player/QueueOps.js';
import type { SavedTrack } from './player/TrackCodec.js';

export { toSaved } from './player/TrackCodec.js';
export type { SavedTrack } from './player/TrackCodec.js';

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
    /** Exposed on the runtime object; tests and characterization suites read it. */
    public failedTracks = new Map<string, number>();
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
    /** Playback decisions live here; this class keeps the public state and wiring. */
    private engineStore?: PlaybackEngine;
    private coordinatorStore?: DestroyCoordinator;

    private get coordinator(): DestroyCoordinator {
        this.coordinatorStore ??= new DestroyCoordinator(
            new DispatcherDestroyHost(this, this.timers, this.client),
            new DispatcherLoggerPort(this.client.logger)
        );
        return this.coordinatorStore;
    }

    private get engine(): PlaybackEngine {
        this.engineStore ??= new PlaybackEngine(new DispatcherPlaybackState(this), {
            player: new ShoukakuPlayerPort(() => this.player),
            sessions: new SessionPort(this.client.db),
            logger: new DispatcherLoggerPort(this.client.logger),
            host: new DispatcherPlaybackHost(this, this.client.db, {
                arm: (seconds, onElapsed) => this.coordinator.armPauseTimeout(seconds, onElapsed),
                clear: () => this.coordinator.clearPauseTimeout(),
            }),
        });
        return this.engineStore;
    }

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
    public callPlayer(action: string, run: () => Promise<unknown>): void {
        void run().catch(error => {
            this.client.logger.warn(`[queue] ${action} failed for ${this.guildId}: ${error}`);
        });
    }

    public async play(attempt: number = 1): Promise<void> {
        await this.engine.play(attempt);
    }

    public async resolveFresh(track: Song): Promise<Song | null> {
        return await freshTrack(this, track);
    }

    public stopTrack(): Promise<unknown> {
        return this.player.stopTrack();
    }

    public seekPlayer(time: number): Promise<unknown> {
        return this.player.seekTo(time);
    }

    public deleteSession(): Promise<void> {
        return this.client.db.deleteSession(this.guildId).catch(() => {});
    }

    public pause(): void {
        this.engine.pause();
    }
    public remove(index: number): void {
        if (!this.player) return;
        if (index > this.queue.length) return;
        this.queue.splice(index, 1);
    }

    public fairPlay(): number {
        const result = fairPlayQueue(this.queue);
        this.queue = result.queue;
        if (result.added) void this.persist();
        return result.added;
    }

    public previousTrack(): void {
        this.engine.previous();
    }
    /** A listener joined a 24/7 session after it paused at track end. */
    public resume247(): void {
        this.engine.resume247();
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
        this.coordinator.armIdleTimeout(seconds);
    }

    public clearIdleTimeout(): void {
        this.coordinator.clearIdleTimeout();
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
        this.coordinator.destroy(preserveSession);
    }

    /**
     * Destroy and wait for Lavalink to remove the old player. A rebuild that
     * joins before this settles can have its new player deleted by the old
     * leave request, leaving the queue populated but silent.
     */
    public async destroyAndWait(preserveSession: boolean = false): Promise<void> {
        await this.coordinator.destroyAndWait(preserveSession);
    }
    public setShuffle(): void {
        if (!this.player) return;
        this.engine.shuffle();
    }

    public async skip(skipto = 1): Promise<void> {
        this.engine.skip(skipto);
    }

    public seek(time: number): void {
        this.engine.seek(time);
    }

    public stop(): void {
        this.engine.stop();
    }
    /**
     * Snapshot playback state so a crash or restart can resume it. The row is
     * deleted when playback ends normally, so a later boot has nothing stale.
     */
    public async persist(): Promise<void> {
        await this.engine.persist();
    }

    public setLoop(loop: 'off' | 'repeat' | 'queue'): void {
        this.engine.setLoop(loop);
    }

    public buildTrack(track: Song | Track, user: User): Song {
        return new Song(track, user);
    }
    public async isPlaying(): Promise<void> {
        await this.engine.isPlaying();
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

    public seedPlaylist(tracks: Song[]): void {
        const unique = playlistSeeds(tracks, items => this.shuffle(items));
        if (!unique.length) return;
        this.seeds = unique;
        this.seed = unique[0];
        void this.persist();
    }

    private rememberSeed(song: Song): void {
        const next = rememberSeedState(this, song);
        this.seed = next.seed;
        this.seeds = next.seeds;
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

    public purgeAutoplay(): number {
        const result = purgeAutoplayQueue(this.queue);
        this.queue = result.queue;
        void this.persist();
        return result.removed;
    }

    private shuffle<T>(items: T[]): T[] {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    private isRecent(track: Song | Track): boolean {
        return checkRecent(this, track as Song);
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

    private async resolveTracks(identifier: string): Promise<Track[]> {
        return await resolveIdentifier(this, identifier);
    }

    private async youtubeIdFor(song: Song): Promise<string | null> {
        return await findYouTubeId(this, song);
    }

    private async relatedTracks(seed: Song): Promise<Track[]> {
        return await getRelatedTracks(seed, {
            youtubeIdFor: song => this.youtubeIdFor(song),
            node: this.node,
        });
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


class DispatcherPlaybackState implements PlaybackState {
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

interface PauseSettingsStore {
    get_247(guildId: string): Promise<unknown>;
    getGuildSettings(guildId: string): Promise<{ timeoutpause?: unknown }>;
}

interface PauseTimeoutPort {
    arm(seconds: number, onElapsed: () => void): void;
    clear(): void;
}

class DispatcherPlaybackHost implements PlaybackHost {
    public constructor(
        private readonly dispatcher: Dispatcher,
        private readonly db: PauseSettingsStore,
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
        if (!this.dispatcher.voiceId || this.dispatcher.restoring) return null;
        return { textId: this.dispatcher.channelId, voiceId: this.dispatcher.voiceId };
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
        const stay = await this.db.get_247(this.dispatcher.guildId);
        if (stay) return { stay: true, seconds: 0 };
        const settings = await this.db.getGuildSettings(this.dispatcher.guildId);
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


class DispatcherDestroyHost implements DestroyHost {
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
        return !this.dispatcher.queue.length && !this.dispatcher.autoplay && !this.dispatcher.current;
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
