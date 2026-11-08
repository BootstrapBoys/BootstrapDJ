import { Channel, Guild } from 'discord.js';
import { LavalinkResponse, LoadType, Node } from 'shoukaku';

import { isFallbackNode } from '../lib/PublicNodes.js';
import { BootstrapClient, Dispatcher } from './index.js';
import { NodeMigrator } from './player/NodeMigrator.js';

export class Queue extends Map<string, Dispatcher> {
    public client: BootstrapClient;
    private readonly rebuilding = new Set<string>();
    private readonly migrator: NodeMigrator;

    public constructor(client: BootstrapClient) {
        super();
        this.client = client;
        this.migrator = new NodeMigrator(
            client,
            (guild, voice, channel, node) => this.spawn(guild, voice, channel, node),
            client.logger
        );
    }

    public get node(): Node | undefined {
        return this.client.shoukaku.options.nodeResolver(this.client.shoukaku.nodes);
    }

    public get hasNode(): boolean {
        return Boolean(this.node);
    }

    private async spawn(
        guild: Guild,
        voice: Channel,
        channel: Channel,
        node: Node
    ): Promise<Dispatcher> {
        const player = await this.client.shoukaku.joinVoiceChannel({
            guildId: guild.id,
            channelId: voice.id,
            shardId: guild.shard.id,
            deaf: true,
        });
        const dispatcher = new Dispatcher({
            client: this.client,
            guildId: guild.id,
            channelId: channel.id,
            voiceId: voice.id,
            player,
            node,
        });
        this.set(guild.id, dispatcher);
        void this.client.db
            .claimSessionLease(
                guild.id,
                this.client.user?.id ?? '',
                this.client.config.botName || this.client.user?.username || '',
                60_000
            )
            .catch(() => {});
        return dispatcher;
    }

    private async applyDefaults(dispatcher: Dispatcher): Promise<void> {
        const defaults: Record<string, string> = await this.client.db
            .getGuildSettings(dispatcher.guildId)
            .catch(() => ({}));
        const volume = Number(defaults.defaultvolume);
        if (Number.isFinite(volume) && volume >= 0 && volume <= 200) {
            void dispatcher.player.setGlobalVolume(volume).catch(() => {});
        }
        if (defaults.defaultrepeat === 'repeat' || defaults.defaultrepeat === 'queue') {
            dispatcher.loop = defaults.defaultrepeat;
        }
        if (defaults.defaultautoplay === 'true') dispatcher.autoplay = true;
        if (defaults.defaultshuffle === 'true') dispatcher.setShuffle();
    }

    public async create(
        guild: Guild,
        voice: Channel | null,
        channel: Channel | null,
        givenNode?: Node
    ): Promise<Dispatcher> {
        if (!voice) throw new Error('No voice channel was provided');
        if (!channel) throw new Error('No text channel was provided');
        if (!guild) throw new Error('No guild was provided');

        const existing = this.get(guild.id);
        if (existing && this.rebuilding.has(guild.id)) return existing;
        if (existing && !existing.isStale) return existing;
        if (existing) {
            const rebuilt = await this.rebuild(existing, givenNode ?? this.node);
            if (!rebuilt) throw new Error('Could not rebuild the player after the Lavalink node changed');
            return rebuilt;
        }

        const node = givenNode ?? this.node;
        if (!node) throw new Error('No Lavalink node is available right now');
        const dispatcher = await this.spawn(guild, voice, channel, node);
        await this.applyDefaults(dispatcher);
        this.client.shoukaku.emitPlayerEvent('playerCreate', dispatcher.player);
        return dispatcher;
    }

    public async rebuild(dispatcher: Dispatcher, node: Node | undefined): Promise<Dispatcher | null> {
        if (this.rebuilding.has(dispatcher.guildId)) return null;
        this.rebuilding.add(dispatcher.guildId);
        try {
            return await this.migrator.rebuild(dispatcher, node);
        } finally {
            this.rebuilding.delete(dispatcher.guildId);
        }
    }

    public holdPositions(fromNodeName?: string): void {
        for (const dispatcher of this.values()) {
            if (!dispatcher.current) continue;
            if (fromNodeName && dispatcher.player.node?.name !== fromNodeName) continue;
            if (!Number.isFinite(dispatcher.player.position)) continue;
            dispatcher.resumePosition = dispatcher.player.position;
            this.client.logger.debug(
                `[queue] held ${dispatcher.guildId} at ${Math.round(dispatcher.player.position / 1000)}s for the switch`
            );
        }
    }

    public async migrateToNode(node: Node | undefined): Promise<number> {
        if (!node) {
            this.client.logger.warn('[queue] migration skipped: no connected node');
            return 0;
        }
        let moved = 0;
        for (const dispatcher of Array.from(this.values())) {
            if (!dispatcher.current && !dispatcher.queue.length) continue;
            if (dispatcher.player.node?.name === node.name && !dispatcher.isStale) continue;
            if (await this.rebuild(dispatcher, node)) moved += 1;
        }
        if (!moved) {
            this.client.logger.info(`[queue] nothing to migrate to "${node.name}" (${this.size} dispatcher(s))`);
        }
        return moved;
    }

    public async migrateToBestNode(): Promise<number> {
        return await this.migrateToNode(this.node);
    }

    private async resolve(node: Node, identifier: string): Promise<LavalinkResponse | null> {
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
    }

    public async search(
        query: string,
        engine: string = this.client.config.searchEngine
    ): Promise<LavalinkResponse | null> {
        const node = this.node;
        if (!node) {
            this.client.logger.warn('Search attempted with no connected Lavalink node');
            return null;
        }
        const direct = /^https?:\/\//.test(query);
        const prefixed = /^[a-z]+search:/i.test(query);
        let result = await this.resolve(node, direct || prefixed ? query : `${engine}:${query}`);

        const fallbackNeedsRetry =
            !direct &&
            isFallbackNode(node.name) &&
            !/^ytm?search:/i.test(query) &&
            (!result || result.loadType === LoadType.EMPTY || result.loadType === LoadType.ERROR);
        if (fallbackNeedsRetry) {
            result = (await this.resolve(node, `ytsearch:${query}`)) ?? result;
        }
        if (!result) this.client.logger.warn(`Lavalink returned no response for ${query}`);
        return result;
    }
}
