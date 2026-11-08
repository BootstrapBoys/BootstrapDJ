import { Channel, Guild } from 'discord.js';
import { LavalinkResponse, LoadType, Node } from 'shoukaku';

import { isFallbackNode } from '../lib/PublicNodes.js';
import { BootstrapClient, Dispatcher } from './index.js';
import { NodeMigrator } from './player/NodeMigrator.js';

const SESSION_LEASE_MS = 60_000;
const DEFAULT_VOLUME_MAX = 200;
const ABSOLUTE_URL = /^https?:\/\//;
const ENGINE_PREFIX = /^[a-z]+search:/i;

/**
 * Guild-id → player registry.
 *
 * Player construction, default settings, and node migration live here so
 * commands only ever ask for `client.queue.get(guildId)` or `create(...)`.
 */
export class Queue extends Map<string, Dispatcher> {
    public client: BootstrapClient;
    /** In-flight rebuild per guild: `create()` must never return its victim. */
    private readonly rebuilds = new Map<string, Promise<Dispatcher | null>>();
    /** Coalesces concurrent first-time spawns for the same guild. */
    private readonly creating = new Map<string, Promise<Dispatcher>>();
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
        const pool = this.client.shoukaku.nodes;
        return this.client.shoukaku.options.nodeResolver(pool);
    }

    public get hasNode(): boolean {
        return this.node !== undefined;
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
        void this.claimLease(guild.id).catch(() => {});
        return dispatcher;
    }

    private claimLease(guildId: string): Promise<unknown> {
        const botId = this.client.user?.id ?? '';
        const botName = this.client.config.botName || this.client.user?.username || '';
        return this.client.db.claimSessionLease(guildId, botId, botName, SESSION_LEASE_MS);
    }

    private async applyDefaults(dispatcher: Dispatcher): Promise<void> {
        const defaults: Record<string, string> = await this.client.db
            .getGuildSettings(dispatcher.guildId)
            .catch(() => ({}));

        const volume = Number(defaults.defaultvolume);
        if (Number.isFinite(volume) && volume >= 0 && volume <= DEFAULT_VOLUME_MAX) {
            // Apply the default before the player is advertised to callers. A
            // fire-and-forget write races a migration restoring the old volume.
            await dispatcher.player.setGlobalVolume(volume).catch(() => {});
        }
        if (defaults.defaultrepeat === 'repeat' || defaults.defaultrepeat === 'queue') {
            dispatcher.loop = defaults.defaultrepeat;
        }
        if (defaults.defaultautoplay === 'true') dispatcher.autoplay = true;
        // A fresh player always has an empty queue, so shuffling here is a
        // no-op. Arm it until the first non-empty queue is about to start.
        if (defaults.defaultshuffle === 'true') dispatcher.pendingDefaultShuffle = true;
    }

    public async create(
        guild: Guild,
        voice: Channel | null,
        channel: Channel | null,
        givenNode?: Node
    ): Promise<Dispatcher> {
        if (!guild) throw new Error('No guild was provided');
        if (!voice) throw new Error('No voice channel was provided');
        if (!channel) throw new Error('No text channel was provided');

        // A rebuild already owns this guild. Await the replacement instead of
        // handing out the dispatcher that is being torn down.
        const rebuilding = this.rebuilds.get(guild.id);
        if (rebuilding) {
            const rebuilt = await rebuilding;
            if (rebuilt) return rebuilt;
        }

        const existing = this.get(guild.id);
        if (existing && !existing.isStale) return existing;
        if (existing) {
            const rebuilt = await this.rebuild(existing, givenNode ?? this.node);
            if (!rebuilt) {
                throw new Error('Could not rebuild the player after the Lavalink node changed');
            }
            return rebuilt;
        }

        // Two commands can race to create the first player; one spawn wins and
        // the other receives the same dispatcher instead of overwriting it.
        const pending = this.creating.get(guild.id);
        if (pending) return await pending;

        const creation = this.spawnAndPrepare(guild, voice, channel, givenNode ?? this.node);
        this.creating.set(guild.id, creation);
        try {
            return await creation;
        } finally {
            if (this.creating.get(guild.id) === creation) this.creating.delete(guild.id);
        }
    }

    private async spawnAndPrepare(
        guild: Guild,
        voice: Channel,
        channel: Channel,
        node: Node | undefined
    ): Promise<Dispatcher> {
        if (!node) throw new Error('No Lavalink node is available right now');
        const dispatcher = await this.spawn(guild, voice, channel, node);
        await this.applyDefaults(dispatcher);
        this.client.shoukaku.emitPlayerEvent('playerCreate', dispatcher.player);
        return dispatcher;
    }

    public async rebuild(dispatcher: Dispatcher, node: Node | undefined): Promise<Dispatcher | null> {
        const inflight = this.rebuilds.get(dispatcher.guildId);
        if (inflight) return await inflight;
        const run = this.migrator.rebuild(dispatcher, node);
        this.rebuilds.set(dispatcher.guildId, run);
        try {
            return await run;
        } finally {
            if (this.rebuilds.get(dispatcher.guildId) === run) {
                this.rebuilds.delete(dispatcher.guildId);
            }
        }
    }

    /** Sample active positions before a node switch so tracks resume in place. */
    public holdPositions(fromNodeName?: string): void {
        for (const dispatcher of this.values()) {
            if (!dispatcher.current) continue;
            if (fromNodeName && dispatcher.player.node?.name !== fromNodeName) continue;
            if (!Number.isFinite(dispatcher.player.position)) continue;
            dispatcher.resumePosition = dispatcher.player.position;
            this.client.logger.debug(
                `[queue] held ${dispatcher.guildId} at ${Math.round(
                    dispatcher.player.position / 1000
                )}s for the switch`
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
            const idle = !dispatcher.current && dispatcher.queue.length === 0;
            if (idle) continue;
            const alreadyThere = dispatcher.player.node?.name === node.name && !dispatcher.isStale;
            if (alreadyThere) continue;
            if (await this.rebuild(dispatcher, node)) moved += 1;
        }

        if (moved === 0) {
            this.client.logger.info(
                `[queue] nothing to migrate to "${node.name}" (${this.size} dispatcher(s))`
            );
        }
        return moved;
    }

    /**
     * Move only the players bound to one node. Used to drain a public fallback
     * once the primary returns: migrating every guild would also yank players
     * off healthy configured standbys.
     */
    public async migrateFromNode(fromName: string, node: Node | undefined): Promise<number> {
        if (!node) return 0;
        let moved = 0;
        for (const dispatcher of Array.from(this.values())) {
            const bound =
                dispatcher.player.node?.name === fromName || dispatcher.node?.name === fromName;
            if (!bound) continue;
            const idle = !dispatcher.current && dispatcher.queue.length === 0;
            if (idle) continue;
            if (await this.rebuild(dispatcher, node)) moved += 1;
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
            const detail = error instanceof Error ? error.message : String(error);
            this.client.logger.error(
                `Lavalink search failed on ${node.name} for ${identifier}: ${detail}`
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

        const literal = ABSOLUTE_URL.test(query);
        const prefixed = ENGINE_PREFIX.test(query);
        const identifier = literal || prefixed ? query : `${engine}:${query}`;
        let result = await this.resolve(node, identifier);

        const retryOnFallback =
            !literal &&
            isFallbackNode(node.name) &&
            !/^ytm?search:/i.test(query) &&
            (result === null || result.loadType === LoadType.EMPTY || result.loadType === LoadType.ERROR);
        if (retryOnFallback) {
            result = (await this.resolve(node, `ytsearch:${query}`)) ?? result;
        }

        if (!result) this.client.logger.warn(`Lavalink returned no response for ${query}`);
        return result;
    }
}
