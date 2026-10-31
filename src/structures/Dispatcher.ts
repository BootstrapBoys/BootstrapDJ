/* eslint-disable @typescript-eslint/typedef */
import { Message, User } from 'discord.js';
import { LoadType, Node, Player, Track, TrackEndEvent, TrackExceptionEvent } from 'shoukaku';

import { BootstrapClient } from './index.js';

/** Autoplay needs YouTube video ids to build a mix, so this prefix is fixed
 * rather than following config.searchEngine (which may be Deezer/Spotify). */
const YOUTUBE_SEARCH = 'ytmsearch';

/** Deezer's public API needs no key and is the only related-artist source
 * available here. A niche artist's YouTube mix is often just that artist. */
const DEEZER_API = 'https://api.deezer.com';

type DeezerTrackRef = { id?: number; artist?: { id?: number } };
type DeezerList = { data?: Array<{ id?: number; name?: string }> };

/** Related artists change rarely and cost 2-3 HTTP calls; cache per artist. */
const relatedArtistCache = new Map<string, string[]>();

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
export interface SavedTrack {
    encoded: string;
    autoplay: boolean;
    info: {
        identifier: string;
        isSeekable: boolean;
        author: string;
        length: number;
        isStream: boolean;
        title: string;
        uri?: string;
        artworkUrl?: string;
        isrc?: string;
        sourceName: string;
    };
}

export interface SavedCurrent extends SavedTrack {
    position: number;
}

/** Strip runtime-only state (requester, live player position) for storage. */
export function toSaved(song: Song): SavedTrack {
    // Optional fields are only set when present: undefined keys vanish through
    // JSON.stringify and the stored row would no longer match this shape.
    const info: SavedTrack['info'] = {
        identifier: song.info.identifier,
        isSeekable: song.info.isSeekable,
        author: song.info.author,
        length: song.info.length,
        isStream: song.info.isStream,
        title: song.info.title,
        sourceName: song.info.sourceName,
    };
    if (song.info.uri) info.uri = song.info.uri;
    if (song.info.artworkUrl) info.artworkUrl = song.info.artworkUrl;
    if (song.info.isrc) info.isrc = song.info.isrc;
    return { encoded: song.encoded, autoplay: song.autoplay, info };
}

/** Rebuild a playable Song; the requester becomes whoever restored it. */
export function fromSaved(saved: SavedTrack, user: User): Song {
    return new Song(
        { encoded: saved.encoded, info: { ...saved.info, position: 0 }, pluginInfo: {} },
        user,
        saved.autoplay
    );
}

export default class Dispatcher {
    private client: BootstrapClient;
    public guildId: string;
    public channelId: string;
    /** Voice channel this dispatcher is bound to; needed for session restore. */
    public voiceId: string | null;
    public player: Player;
    public queue: Song[];
    public stopped: boolean;
    public previous: Song | null;
    public current: Song | null;
    public loop: 'off' | 'repeat' | 'queue';
    public repeat: number;
    public node: Node;
    public paused: boolean;
    public filters: Array<string>;
    public autoplay: boolean;
    /** Last track a user asked for; autoplay seeds from it. */
    public seed: Song | null;
    private toppingUp = false;
    private persistTimer: ReturnType<typeof setInterval> | null = null;
    public nowPlayingMessage: Message | null;
    public history: Song[] = [];

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
        this.repeat = 0;
        this.node = options.node;
        this.paused = false;
        this.filters = [];
        this.autoplay = false;
        this.seed = null;
        this.nowPlayingMessage = null;
        this.persistTimer = setInterval(() => {
            // A paused player's position cannot change and pause() already wrote
            // the state, so the periodic write would only duplicate the row.
            if (!this.paused) void this.persist();
        }, 10_000);
        (this.persistTimer as unknown as { unref?: () => void }).unref?.();

        this.player
            .on('start', () =>
                this.client.shoukaku.emitPlayerEvent('trackStart', this.player, this.current, this)
            )
            .on('end', (data: TrackEndEvent) => {
                // FINISHED is the normal path; LOAD_FAILED/CLEANUP/STOPPED/REPLACED mean
                // Lavalink dropped the track, which used to be completely silent.
                if (data?.reason && String(data.reason) !== 'FINISHED')
                    this.client.logger.warn(
                        `Track ended with reason ${data.reason}: ${
                            this.current?.info?.title ?? 'unknown'
                        }`
                    );
                if (!this.queue.length)
                    this.client.shoukaku.emitPlayerEvent('queueEnd', this.player, this.current, this);
                this.client.shoukaku.emitPlayerEvent('trackEnd', this.player, this.current, this);
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

    /** True when Shoukaku has destroyed the player (node loss) but the
     * dispatcher, its queue and the session row are still around. */
    get isStale(): boolean {
        return this.client.shoukaku.players.get(this.guildId) !== this.player;
    }
    get volume(): number {
        return this.player.volume;
    }
    public async play(): Promise<void> {
        if (!this.exists || (!this.queue.length && !this.current)) {
            return;
        }
        this.current = (this.queue.length !== 0 ? this.queue.shift() : this.queue[0]) ?? null;
        if (!this.current) return;
        this.player.playTrack({ track: { encoded: this.current?.encoded } });
        void this.persist();
        if (this.current) {
            this.history.push(this.current);
            if (this.history.length > 100) {
                this.history.shift();
            }
        }
    }
    public pause(): void {
        if (!this.player) return;
        if (!this.paused) {
            this.player.setPaused(true);
            this.paused = true;
        } else {
            this.player.setPaused(false);
            this.paused = false;
        }
        void this.persist();
    }
    public remove(index: number): void {
        if (!this.player) return;
        if (index > this.queue.length) return;
        this.queue.splice(index, 1);
    }
    public previousTrack(): void {
        if (!this.player) return;
        if (!this.previous) return;
        this.queue.unshift(this.previous);
        this.player.stopTrack();
    }
    public destroy(): void {
        if (this.persistTimer) clearInterval(this.persistTimer);
        this.persistTimer = null;
        void this.client.db.deleteSession(this.guildId).catch(() => {});
        this.queue.length = 0;
        this.history = [];
        this.client.shoukaku.leaveVoiceChannel(this.guildId);
        this.client.queue.delete(this.guildId);
        if (this.stopped) return;
        this.client.shoukaku.emitPlayerEvent('playerDestroy', this.player);
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
        this.repeat = this.repeat == 1 ? 0 : this.repeat;
        this.player.stopTrack();
    }
    public seek(time: number): void {
        if (!this.player) return;
        this.player.seekTo(time);
    }
    public stop(): void {
        if (!this.player) return;
        this.queue.length = 0;
        this.history = [];
        this.loop = 'off';
        this.autoplay = false;
        this.seed = null;
        this.repeat = 0;
        this.stopped = true;
        void this.client.db.deleteSession(this.guildId).catch(() => {});
        this.player.stopTrack();
    }
    /**
     * Snapshot playback state so a crash or restart can resume it. The row is
     * deleted when playback ends normally, so a later boot has nothing stale.
     */
    public async persist(): Promise<void> {
        if (!this.voiceId) return;
        try {
            if (!this.current && !this.queue.length) {
                await this.client.db.deleteSession(this.guildId);
                return;
            }
            await this.client.db.saveSession({
                guildId: this.guildId,
                textId: this.channelId,
                voiceId: this.voiceId,
                current: this.current
                    ? JSON.stringify({
                          ...toSaved(this.current),
                          position: this.player.position,
                      })
                    : null,
                queue: JSON.stringify(this.queue.map(toSaved)),
                loop: this.loop,
                autoplay: this.autoplay,
                volume: this.player.volume,
                paused: this.paused,
            });
        } catch (error) {
            this.client.logger.error(`[session] persist failed for ${this.guildId}: ${error}`);
        }
    }

    public setLoop(loop: any): void {
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
    public enqueue(song: Song): void {
        if (this.autoplay) this.purgeAutoplay();
        this.queue.push(song);
        this.seed = song;
        void this.persist();
        void this.ensureLookahead().catch(() => {});
    }

    /** Same contract as enqueue(), but jumps the queue (used by /playnext). */
    public enqueueNext(song: Song): void {
        if (this.autoplay) this.purgeAutoplay();
        this.queue.unshift(song);
        this.seed = song;
        void this.persist();
        void this.ensureLookahead().catch(() => {});
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
            return await this.Autoplay(this.current ?? undefined);
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

    /** Stable identity: the URI survives re-searching, `encoded` does not
     * (LavaSrc embeds a per-search token, so the same track looks new). */
    private trackKey(track: Song | Track): string {
        const info = track?.info;
        if (info?.uri) return info.uri;
        if (info?.identifier && info?.sourceName) return `${info.sourceName}:${info.identifier}`;
        return track?.encoded ?? '';
    }

    private shuffle<T>(items: T[]): T[] {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    /** Already queued or heard in the recent past? */
    private isRecent(track: Song | Track): boolean {
        const key = this.trackKey(track);
        if (!key) return false;
        if (this.queue.some(queued => this.trackKey(queued) === key)) return true;
        return this.history.slice(-15).some(played => this.trackKey(played) === key);
    }

    /** Choose from candidates, skipping recent tracks and demoting the artists
     * heard in the last few tracks, so a thin mix (a niche artist's radio can
     * be mostly that artist) still drifts instead of looping one name. */
    private chooseFrom(tracks: Track[]): Song | null {
        const botUser = this.client.user;
        if (!botUser) return null;
        const usable = tracks.filter(track => track?.encoded && !this.isRecent(track));
        if (!usable.length) return null;
        const avoid = new Set(
            this.history
                .slice(-3)
                .map(track => track.info?.author)
                .filter((author): author is string => Boolean(author))
        );
        const varied = usable.filter(track => !avoid.has(track.info?.author));
        const pool = varied.length ? varied : usable;
        return this.buildTrack(pool[Math.floor(Math.random() * pool.length)], botUser);
    }

    /** Search a free-text query and pick one result. */
    private async pickFromQuery(query: string): Promise<Song | null> {
        return this.chooseFrom(
            await this.resolveTracks(`${this.client.config.searchEngine}:${query}`)
        );
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
        const id = await this.youtubeIdFor(seed);
        if (!id) return [];
        const resolve = await this.node?.rest
            .resolve(`https://www.youtube.com/watch?v=${id}&list=RD${id}`)
            .catch(() => null);
        if (!resolve || resolve.loadType !== LoadType.PLAYLIST) return [];
        const playlist = resolve.data as { tracks?: Track[] };
        return playlist.tracks ?? [];
    }

    private async pickForSeed(seed: Song): Promise<Song | null> {
        const mix = await this.relatedTracks(seed);
        // Trust the mix only when it leaves the seed artist's orbit: YouTube
        // builds "Parker Jack radio" out of Parker Jack tracks alone.
        const seedArtist = seed.info.author?.toLowerCase() ?? '';
        const hasOtherArtist = mix.some(track => {
            const author = track.info?.author?.toLowerCase() ?? '';
            return Boolean(author) && !author.includes(seedArtist) && !seedArtist.includes(author);
        });
        if (hasOtherArtist) {
            const fromMix = this.chooseFrom(mix);
            if (fromMix) return fromMix;
        }

        // Same-artist radio: hop to a related artist instead.
        const related = this.shuffle(await this.relatedArtistNames(seed)).slice(0, 3);
        for (const name of related) {
            const pick = await this.pickFromQuery(name);
            if (pick) return pick;
        }

        // Nothing related available: more from the same artist, never a stop.
        return await this.pickFromQuery(seed.info.author);
    }

    private async fetchJson<T>(url: string): Promise<T | null> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(url, { signal: controller.signal });
            return response.ok ? ((await response.json()) as T) : null;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Deezer track id for any seed: direct, by ISRC, or by artist+title. */
    private async deezerTrackId(song: Song): Promise<string | null> {
        if (song.info.sourceName === 'deezer' && /^\d+$/.test(song.info.identifier)) {
            return song.info.identifier;
        }
        if (song.info.isrc) {
            const byIsrc = await this.fetchJson<DeezerTrackRef>(
                `${DEEZER_API}/track/isrc:${song.info.isrc}`
            );
            if (byIsrc?.id) return String(byIsrc.id);
        }
        const query = encodeURIComponent(`artist:"${song.info.author}" track:"${song.info.title}"`);
        const found = await this.fetchJson<DeezerList>(`${DEEZER_API}/search?q=${query}&limit=1`);
        const id = found?.data?.[0]?.id;
        return id ? String(id) : null;
    }

    /** Artists Deezer considers similar to the seed's artist. */
    private async relatedArtistNames(song: Song): Promise<string[]> {
        const cacheKey = song.info.author?.toLowerCase() ?? '';
        const cached = relatedArtistCache.get(cacheKey);
        if (cached) return cached;

        const trackId = await this.deezerTrackId(song);
        if (!trackId) return [];
        const track = await this.fetchJson<DeezerTrackRef>(`${DEEZER_API}/track/${trackId}`);
        const artistId = track?.artist?.id;
        if (!artistId) return [];
        const related = await this.fetchJson<DeezerList>(
            `${DEEZER_API}/artist/${artistId}/related?limit=10`
        );
        const names = (related?.data ?? [])
            .map(artist => artist?.name)
            .filter((name): name is string => Boolean(name));
        if (names.length && cacheKey) relatedArtistCache.set(cacheKey, names);
        return names;
    }

    /** Seed pool, newest intent first: the track that just ended, the last
     * user request, the current track, then recent history. */
    private seedCandidates(explicit?: Song): Song[] {
        const seen = new Set<string>();
        const candidates: Song[] = [];
        const add = (track?: Song | null): void => {
            if (!track?.info?.author) return;
            const key = this.trackKey(track);
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push(track);
        };
        add(explicit);
        add(this.seed);
        add(this.current);
        for (const track of this.history.slice(-5)) add(track);

        const rest = this.shuffle(candidates);
        if (!explicit) return rest;
        return [explicit, ...rest.filter(candidate => candidate !== explicit)];
    }

    /**
     * Seed explicitly from a query ("/autoplay Akon"): queue one random result
     * from that search, adopt it as the seed, and start playing if idle.
     */
    public async seedFrom(query: string): Promise<Song | null> {
        this.purgeAutoplay();
        const pick = await this.pickFromQuery(query);
        if (!pick) return null;
        pick.autoplay = true;
        this.seed = pick;
        this.queue.push(pick);
        await this.isPlaying();
        return pick;
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
        if (this.client.config.autoplaySeed) {
            const pick = await this.pickFromQuery(this.client.config.autoplaySeed);
            if (pick) return await this.queueAutoplay(pick);
        }
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
