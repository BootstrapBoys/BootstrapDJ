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
        if (!node || !dispatcher.channelId || !dispatcher.voiceId) return null;
        const guild = this.client.guilds.cache.get(dispatcher.guildId);
        const voice = guild?.channels.cache.get(dispatcher.voiceId);
        const channel = guild?.channels.cache.get(dispatcher.channelId);
        if (!guild || !voice || !channel) return null;

        const saved = {
            current: dispatcher.current,
            queue: dispatcher.queue.slice(),
            history: dispatcher.history.slice(),
            loop: dispatcher.loop,
            autoplay: dispatcher.autoplay,
            seed: dispatcher.seed,
            volume: dispatcher.volume,
            position: Number.isFinite(dispatcher.player.position) ? dispatcher.player.position : 0,
        };
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
            rebuilt.current = saved.current;
            rebuilt.queue = saved.queue;
            rebuilt.history = saved.history;
            rebuilt.loop = saved.loop;
            rebuilt.autoplay = saved.autoplay;
            rebuilt.seed = saved.seed;
            rebuilt.player.setGlobalVolume(saved.volume);

            this.set(guild.id, rebuilt);
            this.client.shoukaku.emitPlayerEvent('playerCreate', rebuilt.player);

            let resumed = false;
            if (saved.current) {
                await rebuilt.play();
                if (saved.position > 1000 && rebuilt.player.track) {
                    rebuilt.player.seekTo(saved.position);
                    resumed = true;
                }
            }
            this.client.logger.info(
                `[queue] moved ${guild.id} to "${node.name}" (${saved.queue.length} queued${
                    resumed ? `, resumed at ${Math.round(saved.position / 1000)}s` : ''
                })`
            );
            return rebuilt;
        } catch (error) {
            this.client.logger.error(`[queue] could not move ${guild.id} to "${node.name}": ${error}`);
            return null;
        }
    }

    /** Move every active guild onto `node` (e.g. a standby after node loss). */
    public async migrateToNode(node: Node | undefined): Promise<number> {
        if (!node) return 0;
        let moved = 0;
        for (const dispatcher of [...this.values()]) {
            if (!dispatcher.current && !dispatcher.queue.length) continue;
            if (dispatcher.player.node?.name === node.name) continue;
            const rebuilt = await this.rebuild(dispatcher, node);
            if (rebuilt) moved += 1;
        }
        return moved;
    }

    /** Move active guilds onto whichever node the resolver currently prefers. */
    public async migrateToBestNode(): Promise<number> {
        return await this.migrateToNode(this.node);
    }

    public async search(query: string): Promise<LavalinkResponse | null> {
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

        const identifier = isUrl ? query : `${this.client.config.searchEngine}:${query}`;
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
