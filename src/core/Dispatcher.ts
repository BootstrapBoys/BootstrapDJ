import { ChannelType, type Message, type User } from 'discord.js';
import {
    LoadType,
    type Node,
    type Player,
    type Track,
    type TrackEndEvent,
    type TrackExceptionEvent,
} from 'shoukaku';

import { isFinishedTrackReason } from '../lib/TrackEndReason.js';
import type { BootstrapClient } from './index.js';
import { PlaybackEngine } from './player/PlaybackEngine.js';
import { PlaybackTimers } from './player/PlaybackTimers.js';
import { ShoukakuPlayerPort } from './player/ShoukakuPlayerPort.js';
import { SessionPort } from './player/SessionPort.js';
import { DispatcherLoggerPort } from './player/DispatcherLoggerPort.js';
import { DestroyCoordinator } from './player/DestroyCoordinator.js';
import {
    DispatcherDestroyHost,
    DispatcherPlaybackHost,
    DispatcherPlaybackState,
} from './player/DispatcherAdapters.js';
import { PresentationRegistry } from './player/PresentationRegistry.js';
import { DeezerClient } from './player/DeezerClient.js';
import { AUTOPLAY_SEEDS, buildSeedCandidates } from './player/AutoplaySeeds.js';
import { findColdStart } from './player/AutoplayColdStart.js';
import { relatedTracks as getRelatedTracks } from './player/YouTubeMix.js';
import {
    affinityWeight,
    type AutoplayAffinity,
    chooseFrom,
    pickForSeed,
} from './player/AutoplayPicker.js';
import {
    isRecent as checkRecent,
    youtubeIdFor as findYouTubeId,
    resolveFresh as freshTrack,
    resolveTracks as resolveIdentifier,
} from './player/TrackResolution.js';
import {
    fairPlayQueue,
    playlistSeeds,
    purgeAutoplayQueue,
    rememberSeedState,
} from './player/QueueOps.js';
import type { SavedTrack } from './player/TrackCodec.js';

export { toSaved } from './player/TrackCodec.js';
export type { SavedTrack } from './player/TrackCodec.js';

/** Listener-time accounting window: the stats sampler runs once a minute. */
const LISTENER_SAMPLE_SECONDS = 60;

/** Autoplay lookahead must not become terminal when every source is empty. */
const LOOKAHEAD_ATTEMPTS = 2;
const LOOKAHEAD_RETRY_MS = 5_000;
const LOOKAHEAD_MAX_RETRIES = 6;
const LOOKAHEAD_RETRY_BASE_MS = 250;

/**
 * A resolved Lavalink track that remembers who requested it. `autoplay` marks
 * filler the bot chose itself, so a user request can displace it.
 */
export class Song implements Track {
    public encoded: string;
    public info: Track['info'] & { requester: User };
    public pluginInfo: unknown;
    public autoplay = false;

    public constructor(track: Song | Track, user: User, autoplay = false) {
        if (!track) throw new Error('Track is not provided');
        const source = track;
        this.encoded = source.encoded;
        this.autoplay = Boolean(autoplay);
        this.info = { ...source.info, requester: user };
    }
}

/** Rehydrate a saved track for the user who owns the restored session. */
export function fromSaved(saved: SavedTrack, user: User): Song {
    const playable: Track = {
        encoded: saved.encoded,
        info: { ...saved.info, position: 0 },
        pluginInfo: {},
    };
    return new Song(playable, user, saved.autoplay);
}

export interface NowPlayingCollector {
    stop(reason?: string): void;
}

/**
 * Public guild player façade. It stores playback state (events, commands, the
 * dashboard and tests read it), forwards Shoukaku player events, and delegates
 * transport, teardown and restore decisions to the focused player modules.
 */
export default class Dispatcher {
    private readonly client: BootstrapClient;
    public guildId: string;
    public channelId: string;
    /** The bound voice channel, used when a session is restored or moved. */
    public voiceId: string | null;
    public player: Player;
    public node: Node;
    private readonly nodeSession: string | null;

    public queue: Song[] = [];
    public stopped = false;
    public previous: Song | null = null;
    public current: Song | null = null;
    public loop: 'off' | 'repeat' | 'queue' = 'off';
    public paused = false;
    /** Position sampled before a node switch; the replacement resumes there
     * instead of losing the seconds spent reconnecting. */
    public resumePosition: number | null = null;
    public filters: string[] = [];
    /** Applied pitch/rate/speed values for the parametric filters. */
    public filterValues: Record<string, number> = {};
    public autoplay = false;
    /** Most recent user request; it heads `seeds`. */
    public seed: Song | null = null;
    /** User requests that can seed autoplay, newest first. */
    public seeds: Song[] = [];
    private fillingLookahead = false;
    /** Background retry for an autoplay lookahead that found nothing. */
    private lookaheadRetry: ReturnType<typeof setTimeout> | null = null;
    private lookaheadFailures = 0;
    /** `defaultshuffle` waits for the first queue that actually has tracks. */
    public pendingDefaultShuffle = false;
    /** Failed attempts per track; a track is dropped after the last one. */
    public failedTracks = new Map<string, number>();
    public nowPlayingMessage: Message | null = null;
    public nowPlayingCollector: NowPlayingCollector | null = null;
    /** "Leave in …" prompt shown when the queue drains. */
    public queueEmptyPrompt: Message | null = null;
    /** /playleave: tear the player down once the queue drains. */
    public leaveOnEnd = false;
    /** 24/7: pause at track end when nobody is listening. */
    public pauseWhenEmpty = false;
    public paused247 = false;
    public history: Song[] = [];
    /** Mutes the periodic persist while a restore is filling the state. */
    public restoring = false;
    /** First track start after a restore must not be recorded twice. */
    public skipRecentRecording = false;

    /** Command replies that expire together with the current track. */
    private presentation?: PresentationRegistry;
    private timersStore?: PlaybackTimers;
    private deezerStore?: DeezerClient;
    private engineStore?: PlaybackEngine;
    private coordinatorStore?: DestroyCoordinator;

    private get timers(): PlaybackTimers {
        this.timersStore ??= new PlaybackTimers();
        return this.timersStore;
    }

    private get deezer(): DeezerClient {
        this.deezerStore ??= new DeezerClient();
        return this.deezerStore;
    }

    private get engine(): PlaybackEngine {
        if (!this.engineStore) {
            this.engineStore = new PlaybackEngine(new DispatcherPlaybackState(this), {
                player: new ShoukakuPlayerPort(() => this.player),
                sessions: new SessionPort(this.client.db),
                logger: new DispatcherLoggerPort(this.client.logger),
                host: new DispatcherPlaybackHost(this, this.client.db, {
                    arm: (seconds, onElapsed) =>
                        this.coordinator.armPauseTimeout(seconds, onElapsed),
                    clear: () => this.coordinator.clearPauseTimeout(),
                }),
            });
        }
        return this.engineStore;
    }

    private get coordinator(): DestroyCoordinator {
        if (!this.coordinatorStore) {
            this.coordinatorStore = new DestroyCoordinator(
                new DispatcherDestroyHost(this, this.timers, this.client),
                new DispatcherLoggerPort(this.client.logger)
            );
        }
        return this.coordinatorStore;
    }

    public constructor(options: DispatcherOptions) {
        const { client, guildId, channelId, voiceId, player, node } = options;
        this.client = client;
        this.guildId = guildId;
        this.channelId = channelId;
        this.voiceId = voiceId ?? null;
        this.player = player;
        this.node = node;
        this.nodeSession = node.sessionId;
        this.startTimers();
        this.bindPlayerEvents();
    }

    private startTimers(): void {
        this.timers.persist = setInterval(() => {
            // Pause already wrote its snapshot and an idle player has nothing
            // to save, so periodic writes would only churn the same row.
            const saving = !this.paused && (this.current || this.queue.length);
            if (saving) void this.persist();
        }, 10_000);
        this.timers.stats = setInterval(() => void this.sampleListeners(), 60_000);
        (this.timers.persist as unknown as { unref?: () => void }).unref?.();
        (this.timers.stats as unknown as { unref?: () => void }).unref?.();
    }

    /** Forward Shoukaku player events under the bot's own event names. */
    private bindPlayerEvents(): void {
        this.player
            .on('start', () => this.emitPlayerEvent('trackStart', this.player, this.current, this))
            .on('end', (data: TrackEndEvent) => this.onTrackEnd(data))
            .on('stuck', () => this.emitPlayerEvent('trackStuck', this.player, this.current))
            .on('exception', (data: TrackExceptionEvent) => this.onTrackException(data))
            .on('closed', (...args) => this.emitPlayerEvent('socketClosed', this.player, ...args));
    }

    private emitPlayerEvent(name: string, ...args: unknown[]): void {
        this.client.shoukaku.emitPlayerEvent(name, ...args);
    }

    private onTrackEnd(data: TrackEndEvent): void {
        const reason = data?.reason;
        // A finished track is routine; any other reason means Lavalink dropped
        // it, which is worth a warning before the queue moves on.
        if (reason && !isFinishedTrackReason(reason)) {
            this.client.logger.warn(
                `Track ended with reason ${reason}: ${this.current?.info?.title ?? 'unknown'}`
            );
        }
        if (!this.queue.length) {
            this.emitPlayerEvent('queueEnd', this.player, this.current, this);
        }
        this.emitPlayerEvent('trackEnd', this.player, this.current, this, reason);
    }

    private onTrackException(data: TrackExceptionEvent): void {
        const severity = data?.exception?.severity ?? 'unknown';
        const message = data?.exception?.message ?? 'no message';
        const cause = data?.exception?.cause;
        const suffix = cause ? ` — ${cause}` : '';
        this.client.logger.error(`Track exception (${severity}): ${message}${suffix}`);
    }

    public get exists(): boolean {
        const { queue } = this.client;
        return queue.has(this.guildId);
    }

    /** A player is stale when Shoukaku dropped it or the node changed its
     * session id; identity alone misses a reconnect with a null session. */
    public get isStale(): boolean {
        const live = this.client.shoukaku.players.get(this.guildId);
        if (live !== this.player) return true;
        const session = this.node.sessionId;
        return session === null || session !== this.nodeSession;
    }

    public get volume(): number {
        return this.player.volume;
    }

    /** Fire-and-forget player call that logs instead of rejecting unhandled. */
    public callPlayer(action: string, run: () => Promise<unknown>): void {
        const pending = run();
        void pending.catch(error => {
            this.client.logger.warn(`[queue] ${action} failed for ${this.guildId}: ${error}`);
        });
    }

    public async play(attempt: number = 1): Promise<void> {
        return await this.engine.play(attempt);
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
        if (!this.player || index < 0 || index >= this.queue.length) return;
        this.queue.splice(index, 1);
        void this.persist();
    }

    /** `/clearqueue`: an explicit mutation must outlive a paused timer gate. */
    public clearQueue(): void {
        this.queue = [];
        void this.persist();
    }

    public fairPlay(): number {
        const ordered = fairPlayQueue(this.queue);
        this.queue = ordered.queue;
        if (ordered.added) void this.persist();
        return ordered.added;
    }

    public previousTrack(): void {
        this.engine.previous();
    }

    /** Someone joined a 24/7 session that had paused itself at track end. */
    public resume247(): void {
        this.engine.resume247();
    }

    /** Count non-bot voice members once a minute for listener-time stats. */
    private async sampleListeners(): Promise<void> {
        if (this.paused247 || this.paused) return;
        const guild = this.client.guilds.cache.get(this.guildId);
        if (!guild || !this.voiceId) return;
        const channel = guild.channels.cache.get(this.voiceId);
        if (!channel) return;
        if (
            channel.type !== ChannelType.GuildVoice &&
            channel.type !== ChannelType.GuildStageVoice
        ) {
            return;
        }
        const rows = channel.members
            .filter(member => !member.user.bot)
            .map(member => ({
                userId: member.id,
                seconds: LISTENER_SAMPLE_SECONDS,
                deafSeconds:
                    member.voice.deaf || member.voice.selfDeaf ? LISTENER_SAMPLE_SECONDS : 0,
            }));
        await this.client.db.recordListenerStatsBulk(this.guildId, rows).catch(() => {});
    }

    public armIdleTimeout(seconds: number): void {
        this.coordinator.armIdleTimeout(seconds);
    }

    public clearIdleTimeout(): void {
        this.coordinator.clearIdleTimeout();
    }

    /** Dismiss the queued "leave in …" prompt, if one is still showing. */
    public clearQueueEmptyPrompt(): void {
        const stale = this.queueEmptyPrompt;
        this.queueEmptyPrompt = null;
        if (stale) void stale.delete().catch(() => {});
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
        this.clearLookaheadRetry();
        this.engineStore?.dispose();
        this.coordinator.destroy(preserveSession);
    }

    /** Wait for Lavalink to drop the old player so a rebuild that joins now
     * cannot have its new player deleted by the previous leave request. */
    public async destroyAndWait(preserveSession: boolean = false): Promise<void> {
        return await this.coordinator.destroyAndWait(preserveSession);
    }

    public setShuffle(): void {
        if (!this.player) return;
        this.engine.shuffle();
        void this.persist();
    }

    public async skip(skipto = 1): Promise<void> {
        this.engine.skip(skipto);
    }

    public seek(time: number): void {
        this.engine.seek(time);
    }

    public stop(): void {
        this.clearLookaheadRetry();
        this.lookaheadFailures = 0;
        this.engine.stop();
    }

    /** Snapshot playback so a crash or restart can resume it. */
    public async persist(): Promise<void> {
        return await this.engine.persist();
    }

    public setLoop(loop: 'off' | 'repeat' | 'queue'): void {
        this.engine.setLoop(loop);
    }

    public buildTrack(track: Song | Track, user: User): Song {
        return new Song(track, user);
    }

    /** Apply `defaultshuffle` once, when the first real queue is about to play. */
    private applyPendingDefaultShuffle(): void {
        if (!this.pendingDefaultShuffle || this.queue.length < 2) return;
        this.pendingDefaultShuffle = false;
        this.engine.shuffle();
        void this.persist();
    }

    public async isPlaying(): Promise<void> {
        this.applyPendingDefaultShuffle();
        return await this.engine.isPlaying();
    }

    /**
     * Queue a user request. It replaces autoplay filler and becomes the seed
     * for later picks, because the chosen track now defines the session.
     */
    public enqueue(song: Song, remember = true, persist = true): void {
        this.admitRequest(song, false, remember, persist);
    }

    /** Insert at the head instead of the tail; /playnext uses this path. */
    public enqueueNext(song: Song, remember = true, persist = true): void {
        this.admitRequest(song, true, remember, persist);
    }

    private resetQueueState(): void {
        this.clearIdleTimeout();
        this.clearQueueEmptyPrompt();
    }

    private dropFiller(): void {
        if (this.autoplay) this.purgeAutoplay();
    }

    private admitRequest(song: Song, front: boolean, remember: boolean, save: boolean): void {
        this.resetQueueState();
        this.clearLookaheadRetry();
        this.lookaheadFailures = 0;
        this.dropFiller();
        if (front) this.queue.unshift(song);
        else this.queue.push(song);
        if (remember) this.rememberSeed(song);
        if (save) void this.persist();
        void this.ensureLookahead().catch(() => {});
    }

    public seedPlaylist(tracks: Song[]): void {
        const lanes = playlistSeeds(tracks, items => this.shuffle(items));
        if (!lanes.length) return;
        const [first] = lanes;
        this.seeds = lanes;
        this.seed = first;
        void this.persist();
    }

    private rememberSeed(song: Song): void {
        const next = rememberSeedState(this, song);
        this.seed = next.seed;
        this.seeds = next.seeds;
    }

    /**
     * Keep one bot pick queued ahead while autoplay is on. A queued user track
     * already outranks the bot, so nothing is added behind it.
     *
     * Autoplay sources can be temporarily empty (Lavalink reconnecting, Deezer
     * rate-limited). A null pick used to end the cycle and leave the bot idle
     * in voice forever, so retry immediately and then keep a bounded background
     * retry alive until autoplay is disabled or a request arrives.
     */
    public async ensureLookahead(): Promise<Song | null> {
        if (!this.autoplay || this.fillingLookahead) return null;
        if (this.queue.length) {
            this.clearLookaheadRetry();
            return null;
        }
        this.fillingLookahead = true;
        try {
            for (let attempt = 1; attempt <= LOOKAHEAD_ATTEMPTS; attempt++) {
                const pick = await this.Autoplay();
                if (pick) {
                    this.lookaheadFailures = 0;
                    this.clearLookaheadRetry();
                    return pick;
                }
                if (!this.autoplay || this.queue.length) return null;
                if (attempt < LOOKAHEAD_ATTEMPTS) {
                    await new Promise<void>(resolve => {
                        setTimeout(resolve, LOOKAHEAD_RETRY_BASE_MS * attempt);
                    });
                }
            }
            this.scheduleLookaheadRetry();
            return null;
        } finally {
            this.fillingLookahead = false;
        }
    }

    /** Cancel a pending lookahead retry (a user request or teardown won). */
    public clearLookaheadRetry(): void {
        if (this.lookaheadRetry) clearTimeout(this.lookaheadRetry);
        this.lookaheadRetry = null;
    }

    private scheduleLookaheadRetry(): void {
        if (this.lookaheadRetry || !this.autoplay) return;
        if (this.lookaheadFailures >= LOOKAHEAD_MAX_RETRIES) {
            this.client.logger.warn(
                `[autoplay] no lookahead found for guild ${this.guildId} after ${this.lookaheadFailures} retries`
            );
            return;
        }
        const timer = setTimeout(() => {
            this.lookaheadRetry = null;
            if (!this.autoplay || this.current || this.queue.length) return;
            this.lookaheadFailures += 1;
            void this.ensureLookahead().catch(() => {});
        }, LOOKAHEAD_RETRY_MS);
        timer.unref();
        this.lookaheadRetry = timer;
    }

    public purgeAutoplay(): number {
        const cleaned = purgeAutoplayQueue(this.queue);
        this.queue = cleaned.queue;
        void this.persist();
        return cleaned.removed;
    }

    private shuffle<T>(items: T[]): T[] {
        const result = [...items];
        let cursor = result.length - 1;
        while (cursor > 0) {
            const swap = Math.floor(Math.random() * (cursor + 1));
            const held = result[cursor];
            result[cursor] = result[swap];
            result[swap] = held;
            cursor -= 1;
        }
        return result;
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

    private async pickFromQuery(query: string): Promise<Song | null> {
        const tracks = await this.resolveTracks(`${this.client.config.searchEngine}:${query}`);
        return this.chooseFrom(tracks);
    }

    /** Pick a cold-start track from Deezer's chart shortlist. */
    private async chartSeed(): Promise<Song | null> {
        const owner = this.client.user;
        if (!this.node || !owner) return null;
        const chart = await this.deezer.chart();
        if (!chart.length) return null;
        const shortlist = this.shuffle(chart).slice(0, 6);
        const links = shortlist
            .map(entry => entry.link)
            .filter((link): link is string => Boolean(link));
        for (const link of links) {
            const resolved = await this.node.rest.resolve(link).catch(() => null);
            if (resolved?.loadType === LoadType.TRACK) {
                return this.buildTrack(resolved.data, owner);
            }
        }
        return null;
    }

    /** Walk the configured curated queries in random order until one resolves. */
    private async curatedSeed(seeds: string[]): Promise<Song | null> {
        const queries = this.shuffle(seeds);
        for (let index = 0; index < queries.length; index += 1) {
            const pick = await this.pickFromQuery(queries[index]);
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

    /** Picker seam for tests; DeezerClient owns the HTTP and cache work. */
    private async relatedArtistNames(song: Song): Promise<string[]> {
        return await this.deezer.relatedArtists(song);
    }

    private seedCandidates(explicit?: Song): Song[] {
        return buildSeedCandidates(this, explicit, items => this.shuffle(items));
    }

    /** Split comma-separated /autoplay input into up to three queries. */
    private seedQueries(query: string | string[]): string[] {
        const values = Array.isArray(query) ? query : [query];
        const queries: string[] = [];
        for (const value of values) {
            for (const part of value.split(',')) {
                const trimmed = part.trim();
                if (trimmed) queries.push(trimmed);
            }
        }
        return queries.slice(0, AUTOPLAY_SEEDS);
    }

    private markAsFiller(song: Song): void {
        song.autoplay = true;
    }

    private async resolveSeedLanes(queries: string[]): Promise<Song[]> {
        const picks: Array<Song> = [];
        for (const query of queries) {
            const candidate = await this.pickFromQuery(query);
            if (!candidate) continue;
            this.markAsFiller(candidate);
            picks.push(candidate);
        }
        return picks;
    }

    /**
     * Seed from one or more comma-separated queries: queue a pick from the
     * first query, record every result as a seed lane, and start if idle.
     */
    public async seedFrom(query: string | string[]): Promise<Song | null> {
        this.purgeAutoplay();
        const picks = await this.resolveSeedLanes(this.seedQueries(query));
        if (!picks.length) return null;
        // The first query must remain the newest lane, so remember it last.
        for (let index = picks.length - 1; index >= 0; index -= 1) {
            this.rememberSeed(picks[index]);
        }
        const opener = picks[0];
        this.queue.splice(this.queue.length, 0, opener);
        await this.isPlaying();
        return opener;
    }

    private async queueAutoplay(pick: Song): Promise<Song> {
        this.markAsFiller(pick);
        this.queue.splice(this.queue.length, 0, pick);
        await this.isPlaying();
        return pick;
    }

    private async autoplayFromSeeds(explicit?: Song): Promise<Song | null> {
        const seeds = this.seedCandidates(explicit);
        for (const seed of seeds) {
            const candidate = await this.pickForSeed(seed);
            if (candidate) return await this.queueAutoplay(candidate);
        }
        return null;
    }

    private async autoplayColdStart(): Promise<Song | null> {
        const cold = await findColdStart({
            getConfig: () => this.client.db.getAutoplaySetting(this.guildId),
            config: this.client.config,
            chartSeed: () => this.chartSeed(),
            curatedSeed: seeds => this.curatedSeed(seeds),
            pickFromQuery: query => this.pickFromQuery(query),
        });
        if (cold) return await this.queueAutoplay(cold);
        return null;
    }

    /** Produce and queue one bot pick; null means every source was empty. */
    public async Autoplay(explicit?: Song): Promise<Song | null> {
        const seeded = await this.autoplayFromSeeds(explicit);
        if (seeded) return seeded;
        const coldStart = await this.autoplayColdStart();
        if (coldStart) return coldStart;
        this.client.logger.error(`[autoplay] no usable track found for guild ${this.guildId}`);
        return null;
    }

    public async setAutoplay(enabled: boolean): Promise<Song | null> {
        this.autoplay = enabled;
        this.lookaheadFailures = 0;
        this.clearLookaheadRetry();
        void this.persist();
        if (!enabled) {
            this.purgeAutoplay();
            return null;
        }
        const idle = !this.current && !this.queue.length;
        return await (idle ? this.Autoplay() : this.ensureLookahead());
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
