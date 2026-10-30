/* eslint-disable @typescript-eslint/typedef */
import { Message, User } from 'discord.js';
import { LoadType, Node, Player, Track, TrackEndEvent, TrackExceptionEvent } from 'shoukaku';

import { Lavamusic } from './index.js';

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
export default class Dispatcher {
    private client: Lavamusic;
    public guildId: string;
    public channelId: string;
    public player: Player;
    public queue: Song[];
    public stopped: boolean;
    public previous: Song | null;
    public current: Song | null;
    public loop: 'off' | 'repeat' | 'queue';
    public requester: User;
    public repeat: number;
    public node: Node;
    public paused: boolean;
    public filters: Array<string>;
    public autoplay: boolean;
    /** Last track a user asked for; autoplay seeds from it. */
    public seed: Song | null;
    private toppingUp = false;
    public nowPlayingMessage: Message | null;
    public history: Song[] = [];

    constructor(options: DispatcherOptions) {
        this.client = options.client;
        this.guildId = options.guildId;
        this.channelId = options.channelId;
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
    get volume(): number {
        return this.player.volume;
    }
    public async play(): Promise<void> {
        if (!this.exists || (!this.queue.length && !this.current)) {
            return;
        }
        this.current = this.queue.length !== 0 ? this.queue.shift() : this.queue[0];
        if (!this.current) return;
        this.player.playTrack({ track: { encoded: this.current?.encoded } });
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
        this.player.stopTrack();
    }
    public setLoop(loop: any): void {
        this.loop = loop;
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
        void this.ensureLookahead().catch(() => {});
    }

    /** Same contract as enqueue(), but jumps the queue (used by /playnext). */
    public enqueueNext(song: Song): void {
        if (this.autoplay) this.purgeAutoplay();
        this.queue.unshift(song);
        this.seed = song;
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

    /** Choose from candidates, skipping recent tracks and demoting the artist
     * that just played so consecutive picks do not chain one name. */
    private chooseFrom(tracks: Track[]): Song | null {
        const usable = tracks.filter(track => track?.encoded && !this.isRecent(track));
        if (!usable.length) return null;
        const lastAuthor = this.history[this.history.length - 1]?.info?.author;
        const varied = usable.filter(track => track.info?.author !== lastAuthor);
        const pool = varied.length ? varied : usable;
        return this.buildTrack(pool[Math.floor(Math.random() * pool.length)], this.client.user);
    }

    /** Search a free-text query and pick one result. */
    private async pickFromQuery(query: string): Promise<Song | null> {
        const resolve = await this.node?.rest
            .resolve(`${this.client.config.searchEngine}:${query}`)
            .catch(() => null);
        const data = resolve?.data;
        return Array.isArray(data) ? this.chooseFrom(data as Track[]) : null;
    }

    /** YouTube id for a track; searches for the song when it came from another
     * source, so a Deezer/Spotify seed can still feed a YouTube mix. */
    private async youtubeIdFor(song: Song): Promise<string | null> {
        const looksLikeId = (value?: string): boolean => Boolean(value && /^[\w-]{11}$/.test(value));
        if (song.info.sourceName === 'youtube' && looksLikeId(song.info.identifier)) {
            return song.info.identifier;
        }
        const resolve = await this.node?.rest
            .resolve(`${this.client.config.searchEngine}:${song.info.title} ${song.info.author}`)
            .catch(() => null);
        const data = resolve?.data;
        if (!Array.isArray(data)) return null;
        const match = (data as Track[]).find(
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
        const fromMix = this.chooseFrom(await this.relatedTracks(seed));
        if (fromMix) return fromMix;
        return await this.pickFromQuery(seed.info.author);
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
    client: Lavamusic;
    guildId: string;
    channelId: string;
    player: Player;
    node: Node;
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
