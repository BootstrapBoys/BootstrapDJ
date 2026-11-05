import { Channel, Guild } from 'discord.js';
import { LavalinkResponse, LoadType, Node } from 'shoukaku';

import { BootstrapClient, Dispatcher } from './index.js';
import { isFallbackNode } from '../utils/PublicNodes.js';
export class Queue extends Map {
    public client: BootstrapClient;
    constructor(client: BootstrapClient) {
        super();
        this.client = client;
    }
    public get(guildId: string): Dispatcher {
        return super.get(guildId);
    }
    public set(guildId: string, dispatcher: Dispatcher): this {
        return super.set(guildId, dispatcher);
    }
    public delete(guildId: string): boolean {
        return super.delete(guildId);
    }
    public clear(): void {
        return super.clear();
    }

    /** Guards against two code paths (command + migration) rebuilding the same
     * guild at once — Shoukaku throws if joinVoiceChannel runs twice. */
    private readonly rebuilding = new Set<string>();

    public get node(): Node | undefined {
        return this.client.shoukaku.options.nodeResolver(this.client.shoukaku.nodes);
    }

    /** False while every Lavalink node is disconnected or reconnecting. */
    public get hasNode(): boolean {
        return Boolean(this.node);
    }

    public async create(
        guild: Guild,
        // Only the channel ids are used; callers have already validated voice state.
        voice: Channel | null,
        channel: Channel | null,
        givenNode?: Node
    ): Promise<Dispatcher> {
        let dispatcher = this.get(guild.id);
        if (!voice) throw new Error('No voice channel was provided');
        if (!channel) throw new Error('No text channel was provided');
        if (!guild) throw new Error('No guild was provided');
        if (dispatcher && this.rebuilding.has(guild.id)) return dispatcher;
        if (!dispatcher) {
            const node = givenNode ?? this.node;
            if (!node) throw new Error('No Lavalink node is available right now');
            const player = await this.client.shoukaku.joinVoiceChannel({
                guildId: guild.id,
                channelId: voice.id,
                shardId: guild.shard.id,
                deaf: true,
            });

            dispatcher = new Dispatcher({
                client: this.client,
                guildId: guild.id,
                channelId: channel.id,
                voiceId: voice.id,
                player,
                node,
            });

            this.set(guild.id, dispatcher);
            // Apply guild defaults once, at player creation. A session restore
            // overwrites volume/loop later, so this only affects fresh sessions.
            const defaults: Record<string, string> = await this.client.db.getGuildSettings(guild.id).catch(() => ({}));
            const volume = Number(defaults.defaultvolume);
            if (Number.isFinite(volume) && volume >= 0 && volume <= 200) {
                dispatcher.player.setGlobalVolume(volume);
            }
            if (defaults.defaultrepeat === 'repeat' || defaults.defaultrepeat === 'queue') {
                dispatcher.loop = defaults.defaultrepeat;
            }
            if (defaults.defaultautoplay === 'true') {
                dispatcher.autoplay = true;
            }
            if (defaults.defaultshuffle === 'true') {
                dispatcher.setShuffle();
            }
            this.client.shoukaku.emitPlayerEvent('playerCreate', dispatcher.player);
            return dispatcher;
        } else {
            if (!dispatcher.isStale) return dispatcher;
            return (await this.rebuild(dispatcher, givenNode ?? this.node)) ?? dispatcher;
        }
    }

    /**
     * Recreate a dispatcher on a specific node, carrying its queue, current
     * track, loop/autoplay/volume and playback position across. Used when the
     * node dies (move to standby) and when it returns (move back).
     */
    public async rebuild(dispatcher: Dispatcher, node: Node | undefined): Promise<Dispatcher | null> {
        if (this.rebuilding.has(dispatcher.guildId)) return null;
        this.rebuilding.add(dispatcher.guildId);
        try {
            return await this.doRebuild(dispatcher, node);
        } finally {
            this.rebuilding.delete(dispatcher.guildId);
        }
    }

    private async doRebuild(dispatcher: Dispatcher, node: Node | undefined): Promise<Dispatcher | null> {
        if (!node || !dispatcher.channelId || !dispatcher.voiceId) return null;
        const guild = this.client.guilds.cache.get(dispatcher.guildId);
        const voice = guild?.channels.cache.get(dispatcher.voiceId);
        const channel = guild?.channels.cache.get(dispatcher.channelId);
        if (!guild || !voice || !channel) {
            this.client.logger.warn(
                `[queue] cannot rebuild ${dispatcher.guildId}: guild=${Boolean(guild)} voice=${Boolean(voice)} channel=${Boolean(channel)}`
            );
            return null;
        }

        const saved = {
            current: dispatcher.current,
            queue: dispatcher.queue.slice(),
            history: dispatcher.history.slice(),
            loop: dispatcher.loop,
            autoplay: dispatcher.autoplay,
            seed: dispatcher.seed,
            seeds: dispatcher.seeds.slice(),
            volume: dispatcher.volume,
            position:
                dispatcher.resumePosition ??
                (Number.isFinite(dispatcher.player.position) ? dispatcher.player.position : 0),
            paused: dispatcher.paused,
        };
        this.client.logger.info(
            `[queue] rebuilding ${dispatcher.guildId} on "${node.name}" (was "${dispatcher.player.node?.name}")`
        );
        dispatcher.destroy();

        try {
            const player = await this.client.shoukaku.joinVoiceChannel({
                guildId: guild.id,
                channelId: voice.id,
                shardId: guild.shard.id,
                deaf: true,
            });
            const rebuilt = new Dispatcher({
                client: this.client,
                guildId: guild.id,
                channelId: channel.id,
                voiceId: voice.id,
                player,
                node,
            });
            // play() pulls from the queue into current, so the saved current must
            // sit at the head of the queue; pre-setting current made it skip a
            // track and play the next song at the old timestamp.
            rebuilt.current = null;
            rebuilt.queue = saved.current ? [saved.current, ...saved.queue] : saved.queue;
            rebuilt.history = saved.history;
            rebuilt.loop = saved.loop;
            rebuilt.autoplay = saved.autoplay;
            rebuilt.seed = saved.seed;
            rebuilt.seeds = saved.seeds;
            rebuilt.player.setGlobalVolume(saved.volume);

            this.set(guild.id, rebuilt);
            this.client.shoukaku.emitPlayerEvent('playerCreate', rebuilt.player);

            let resumedAt = 0;
            if (saved.current) {
                await rebuilt.play();
                if (saved.position > 1000 && rebuilt.player.track) {
                    try {
                        await rebuilt.player.seekTo(saved.position);
                        resumedAt = saved.position;
                    } catch (error) {
                        this.client.logger.warn(`[queue] seek to ${saved.position}ms failed: ${error}`);
                    }
                }
                if (saved.paused) {
                    try {
                        await rebuilt.player.setPaused(true);
                        rebuilt.paused = true;
                    } catch (error) {
                        this.client.logger.warn(`[queue] could not restore paused state: ${error}`);
                    }
                }
                rebuilt.resumePosition = null;
            }
            this.client.logger.info(
                `[queue] moved ${guild.id} to "${node.name}" (${saved.queue.length} queued${
                    resumedAt ? `, resumed at ${Math.round(resumedAt / 1000)}s` : ''
                })`
            );
            return rebuilt;
        } catch (error) {
            this.client.logger.error(`[queue] could not move ${guild.id} to "${node.name}": ${error}`);
            return null;
        }
    }

    /** Sample the live position for every active guild on a node (or all),
     * so the replacement player seeks to the moment the old node was lost
     * instead of the moment its voice connection finished. */
    public holdPositions(fromNodeName?: string): void {
        for (const dispatcher of this.values()) {
            if (!dispatcher.current) continue;
            if (fromNodeName && dispatcher.player.node?.name !== fromNodeName) continue;
            if (Number.isFinite(dispatcher.player.position)) {
                dispatcher.resumePosition = dispatcher.player.position;
                this.client.logger.debug(
                    `[queue] held ${dispatcher.guildId} at ${Math.round(dispatcher.player.position / 1000)}s for the switch`
                );
            }
        }
    }

    /** Move every active guild onto `node` (e.g. a standby after node loss). */
    public async migrateToNode(node: Node | undefined): Promise<number> {
        if (!node) {
            this.client.logger.warn('[queue] migration skipped: no connected node');
            return 0;
        }
        let moved = 0;
        for (const dispatcher of [...this.values()]) {
            if (!dispatcher.current && !dispatcher.queue.length) continue;
            if (dispatcher.player.node?.name === node.name) continue;
            const rebuilt = await this.rebuild(dispatcher, node);
            if (rebuilt) moved += 1;
        }
        if (!moved) {
            this.client.logger.info(
                `[queue] nothing to migrate to "${node.name}" (${this.size} dispatcher(s))`
            );
        }
        return moved;
    }

    /** Move active guilds onto whichever node the resolver currently prefers. */
    public async migrateToBestNode(): Promise<number> {
        return await this.migrateToNode(this.node);
    }

    public async search(query: string, engine: string = this.client.config.searchEngine): Promise<LavalinkResponse | null> {
        const node = this.node;
        if (!node) {
            this.client.logger.warn('Search attempted with no connected Lavalink node');
            return null;
        }

        const isUrl = /^https?:\/\//.test(query);
        const resolve = async (identifier: string): Promise<LavalinkResponse | null> => {
            try {
                return (await node.rest.resolve(identifier)) ?? null;
            } catch (error) {
                this.client.logger.error(
                    `Lavalink search failed on ${node.name} for ${identifier}: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
                return null;
            }
        };

        const identifier = isUrl ? query : `${engine}:${query}`;
        let result = await resolve(identifier);

        // A public fallback usually has no LavaSrc, so dzsearch comes back empty;
        // retry with plain YouTube search on that node before giving up.
        if (
            !isUrl &&
            isFallbackNode(node.name) &&
            !/^ytm?search:/i.test(query) &&
            (!result || result.loadType === LoadType.EMPTY || result.loadType === LoadType.ERROR)
        ) {
            const retried = await resolve(`ytsearch:${query}`);
            if (retried) result = retried;
        }

        if (!result) this.client.logger.warn(`Lavalink returned no response for ${query}`);
        return result;
    }

}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
