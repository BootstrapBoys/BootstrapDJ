import { Guild } from 'discord.js';
import { LavalinkResponse, Node } from 'shoukaku';

import { Dispatcher, Lavamusic } from './index.js';
export class Queue extends Map {
    public client: Lavamusic;
    constructor(client: Lavamusic) {
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
        voice: any,
        channel: any,
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
        const regex = /^https?:\/\//;
        try {
            const result = await node.rest.resolve(
                regex.test(query) ? query : `${this.client.config.searchEngine}:${query}`
            );
            if (!result) this.client.logger.warn(`Lavalink returned no response for ${query}`);
            return result ?? null;
        } catch (err) {
            this.client.logger.error(
                `Lavalink search failed on ${node.name} for ${query}: ${
                    err instanceof Error ? err.message : String(err)
                }`
            );
            return null;
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
