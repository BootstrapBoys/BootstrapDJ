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
            return dispatcher;
        }
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
