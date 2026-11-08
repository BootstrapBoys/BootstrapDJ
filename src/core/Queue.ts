import { Channel, Guild } from 'discord.js';
import { LavalinkResponse, LoadType, Node } from 'shoukaku';

import { isFallbackNode } from '../lib/PublicNodes.js';
import { BootstrapClient, Dispatcher } from './index.js';

type ResumableState = {
    current: Dispatcher['current'];
    queue: Dispatcher['queue'];
    history: Dispatcher['history'];
    loop: Dispatcher['loop'];
    autoplay: boolean;
    seed: Dispatcher['seed'];
    seeds: Dispatcher['seeds'];
    volume: number;
    position: number;
    paused: boolean;
};

export class Queue extends Map<string, Dispatcher> {
    public client: BootstrapClient;
    private readonly rebuilding = new Set<string>();

    public constructor(client: BootstrapClient) {
        super();
        this.client = client;
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

    private snapshot(dispatcher: Dispatcher): ResumableState {
        return {
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
    }

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

        const state = this.snapshot(dispatcher);
        this.client.logger.info(
            `[queue] rebuilding ${dispatcher.guildId} on "${node.name}" (was "${dispatcher.player.node?.name}")`
        );
        await dispatcher.destroyAndWait(true);

        try {
            const rebuilt = await this.spawn(guild, voice, channel, node);
            rebuilt.current = null;
            rebuilt.queue = state.current ? [state.current, ...state.queue] : state.queue;
            rebuilt.history = state.history;
            rebuilt.loop = state.loop;
            rebuilt.autoplay = state.autoplay;
            rebuilt.seed = state.seed;
            rebuilt.seeds = state.seeds;
            void rebuilt.player.setGlobalVolume(state.volume).catch(() => {});
            this.client.shoukaku.emitPlayerEvent('playerCreate', rebuilt.player);

            let resumedAt = 0;
            if (state.current) {
                await rebuilt.play();
                if (state.position > 1000 && rebuilt.player.track) {
                    try {
                        await rebuilt.player.seekTo(state.position);
                        resumedAt = state.position;
                    } catch (error) {
                        this.client.logger.warn(`[queue] seek to ${state.position}ms failed: ${error}`);
                    }
                }
                if (state.paused) {
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
                `[queue] moved ${guild.id} to "${node.name}" (${state.queue.length} queued${
                    resumedAt ? `, resumed at ${Math.round(resumedAt / 1000)}s` : ''
                })`
            );
            return rebuilt;
        } catch (error) {
            this.client.logger.error(`[queue] could not move ${guild.id} to "${node.name}": ${error}`);
            return null;
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
