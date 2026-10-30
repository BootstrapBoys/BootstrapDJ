/* eslint-disable @typescript-eslint/typedef */
import { Message, User } from 'discord.js';
import { Node, Player, Track, TrackEndEvent, TrackExceptionEvent } from 'shoukaku';

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
    }

    /** Same contract as enqueue(), but jumps the queue (used by /playnext). */
    public enqueueNext(song: Song): void {
        if (this.autoplay) this.purgeAutoplay();
        this.queue.unshift(song);
        this.seed = song;
    }

    /** Drop every bot-queued track. Returns how many were removed. */
    public purgeAutoplay(): number {
        const before = this.queue.length;
        this.queue = this.queue.filter(track => !track.autoplay);
        return before - this.queue.length;
    }

    private recentAuthors(count: number): Set<string> {
        return new Set(
            this.history
                .slice(-count)
                .map(track => track.info?.author)
                .filter((author): author is string => Boolean(author))
        );
    }

    private shuffle<T>(items: T[]): T[] {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    /**
     * Seed pool, most recent intent first: the track that just ended, the last
     * user request, the current track, then recent history. Authors heard in
     * the last two tracks are demoted so autoplay does not chain one artist.
     */
    private seedCandidates(explicit?: Song): string[] {
        const authors = new Set<string>();
        const add = (track?: Song | null): void => {
            const author = track?.info?.author;
            if (author) authors.add(author);
        };
        add(explicit);
        add(this.seed);
        add(this.current);
        for (const track of this.history.slice(-5)) add(track);
        if (!authors.size && this.client.config.autoplaySeed) {
            authors.add(this.client.config.autoplaySeed);
        }

        const avoid = this.recentAuthors(2);
        const fresh = [...authors].filter(author => !avoid.has(author));
        return this.shuffle(fresh.length ? fresh : [...authors]);
    }

    /** Search one seed and return an unplayed, unqueued track from it. */
    private async pickRelated(seed: string): Promise<Song | null> {
        const resolve = await this.node?.rest
            .resolve(`${this.client.config.searchEngine}:${seed}`)
            .catch(() => null);
        const data = resolve?.data;
        if (!Array.isArray(data) || !data.length) return null;

        const avoid = this.recentAuthors(2);
        const usable = (data as Track[]).filter(track => {
            if (!track?.encoded) return false;
            if (this.queue.some(queued => queued.encoded === track.encoded)) return false;
            if (this.history.some(played => played.encoded === track.encoded)) return false;
            return true;
        });
        const varied = usable.filter(track => !avoid.has(track.info?.author));
        const pool = varied.length ? varied : usable;
        if (!pool.length) return null;

        return this.buildTrack(pool[Math.floor(Math.random() * pool.length)], this.client.user);
    }

    /**
     * Seed explicitly from a query ("/autoplay Akon"): queue one random result
     * from that search, adopt it as the seed, and start playing if idle.
     */
    public async seedFrom(query: string): Promise<Song | null> {
        this.purgeAutoplay();
        const pick = await this.pickRelated(query);
        if (!pick) return null;
        pick.autoplay = true;
        this.seed = pick;
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
            const pick = await this.pickRelated(seed);
            if (pick) {
                pick.autoplay = true;
                this.queue.push(pick);
                await this.isPlaying();
                return pick;
            }
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
        // Only seed immediately when there is nothing to play; otherwise the
        // track end handler tops the queue up.
        if (this.current || this.queue.length) return null;
        return await this.Autoplay();
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
