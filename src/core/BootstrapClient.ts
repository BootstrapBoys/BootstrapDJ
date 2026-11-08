import type { EarlCommandHandler, EarlSetupRefresher } from '../types.js';
import { Client, ClientOptions, Collection, EmbedBuilder, Events, Interaction } from 'discord.js';
import type { NodeOption } from 'shoukaku';

import config from '../config.js';
import { startDashboard } from '../dashboard/server.js';
import {
    type AccessResult,
    type ActionError,
    dashboardFilter,
    type DashboardGuild,
    dashboardGuilds,
    dashboardPlayer,
    dashboardPlayerAction,
    type FilterResult,
    guildAccessFor,
    type PlayerSnapshot,
} from '../dashboard/shardApi.js';
import ServerData from '../data/server.js';
import { loadBots } from '../lib/BotsFile.js';
import { attachSlashPublisher, installCommands } from '../lib/CommandManager.js';
import { installEvents } from '../lib/EventManager.js';
import { findBestPublicNode, toNodeOption } from '../lib/PublicNodes.js';
import { Utils } from '../lib/Utils.js';
import loadPlugins from '../plugin/index.js';
import { Command, Queue, ShoukakuClient } from './index.js';
import Logger from './Logger.js';

const CONTROL_BUTTON_IDS = new Set([
    'LOW_VOL_BUT',
    'HIGH_VOL_BUT',
    'PAUSE_BUT',
    'PREV_BUT',
    'SKIP_BUT',
    'STOP_BUT',
    'LOOP_BUT',
    'SHUFFLE_BUT',
    'REWIND_BUT',
    'FORWARD_BUT',
]);

export default class BootstrapClient extends Client {
    public commands: Collection<string, Command> = new Collection();
    public aliases: Collection<string, string> = new Collection();
    public db = new ServerData();
    public cooldown: Collection<string, Collection<string, number>> = new Collection();
    public config = config;
    public logger = new Logger();
    public readonly color = config.color;
    public shoukaku!: ShoukakuClient;
    public utils = Utils;
    public queue = new Queue(this);
    public shuttingDown = false;
    public earlCommand?: EarlCommandHandler;
    public earlRefreshSetup?: EarlSetupRefresher;
    private statsMaintenanceStarted = false;

    public constructor(options: ClientOptions) {
        super(options);
    }

    /** Global singletons belong to shard 0 or the first BOTS_FILE child. */
    public get isCoordinator(): boolean {
        if (this.shard) return this.shard.ids.includes(0);
        if (this.config.botsFile) return this.config.botCoordinator;
        return true;
    }

    public dashboardLocalGuildIds(): string[] {
        return [...this.guilds.cache.keys()];
    }

    public dashboardLocalGuilds(userId: string | null): Promise<DashboardGuild[]> {
        return dashboardGuilds(this, userId);
    }

    public dashboardLocalAccess(userId: string | null, guildId: string): Promise<AccessResult> {
        return guildAccessFor(this, userId, guildId);
    }

    public dashboardLocalPlayer(guildId: string): {
        found: boolean;
        player: PlayerSnapshot | null;
    } {
        return dashboardPlayer(this, guildId);
    }

    public dashboardLocalPlayerAction(
        guildId: string,
        action: string,
        value: number
    ): Promise<ActionError> {
        return dashboardPlayerAction(this, guildId, action, value);
    }

    public dashboardLocalFilter(
        guildId: string,
        id: string,
        enabled: boolean,
        value?: number
    ): FilterResult {
        return dashboardFilter(this, guildId, id, enabled, value);
    }

    public clearGuildSettingsCache(guildId: string): void {
        this.db.clearGuildSettingsCache(guildId);
    }

    public embed(): EmbedBuilder {
        return new EmbedBuilder();
    }

    private async connectLavalink(): Promise<void> {
        if (this.config.lavalink.length > 0) {
            this.shoukaku = new ShoukakuClient(this, this.config.lavalink);
            return;
        }
        const nodes = this.config.autoNode ? await this.publicNodes() : [];
        this.shoukaku = new ShoukakuClient(this, nodes);
    }

    private startHeartbeat(): void {
        if (!this.config.botsFile || !this.user) return;
        const beat = (): void => {
            void this.db
                .heartbeatBot(this.user!.id, this.config.botName || this.user!.username)
                .catch(() => {});
        };
        beat();
        const timer = setInterval(beat, 30_000);
        timer.unref();
    }

    public async start(token: string): Promise<void> {
        await this.connectLavalink();
        await this.db
            .initialize()
            .catch(error => this.logger.warn(`[db] SQLite initialization failed: ${error}`));
        this.startStatsMaintenance();

        const slashBody = await installCommands(this);
        this.logger.info('Successfully loaded commands!');
        await installEvents(this);
        this.logger.info('Successfully loaded events!');
        await loadPlugins(this);
        attachSlashPublisher(this, slashBody);

        await this.login(token);
        this.startHeartbeat();
        startDashboard(this);

        this.on(Events.InteractionCreate, async (interaction: Interaction): Promise<void> => {
            if (!interaction.isButton() || !interaction.guildId) return;
            if (interaction.message?.author?.id !== this.user?.id) return;
            if (CONTROL_BUTTON_IDS.has(interaction.customId)) {
                this.emit('setupButtons', interaction);
            }
        });
    }

    public async preferredBotStatus(
        guildId: string
    ): Promise<{ allowed: boolean; name: string | null }> {
        if (!this.config.botsFile || !this.user) return { allowed: true, name: null };
        let bots;
        try {
            bots = loadBots(this.config.botsFile);
        } catch {
            return { allowed: true, name: null };
        }
        if (bots.length <= 1) return { allowed: true, name: null };

        const lease = await this.db.getSessionLease(guildId).catch(() => null);
        if (lease && lease.expiresAt.getTime() > Date.now()) {
            return lease.botId === this.user.id
                ? { allowed: true, name: lease.botName }
                : { allowed: false, name: lease.botName };
        }
        const guild = this.guilds.cache.get(guildId);
        if (!guild) return { allowed: true, name: null };
        for (const bot of bots) {
            if (bot.clientId === this.user.id) return { allowed: true, name: bot.name };
            const presence = await this.db.getBotPresence(bot.clientId).catch(() => null);
            if (!presence) continue;
            if (Date.now() - new Date(presence.lastSeen).getTime() > 90_000) continue;
            if (!guild.members.cache.has(bot.clientId)) continue;
            return { allowed: false, name: bot.name };
        }
        return { allowed: true, name: null };
    }

    private startStatsMaintenance(): void {
        if (this.statsMaintenanceStarted || !this.isCoordinator) return;
        const intervalHours = this.config.statsPruneIntervalHours;
        if (!Number.isFinite(intervalHours) || intervalHours <= 0) return;
        this.statsMaintenanceStarted = true;
        const run = (): void => {
            void this.db
                .pruneStats()
                .then(result => {
                    const removed =
                        result.daily +
                        result.tracks +
                        result.listeners +
                        result.userTracks +
                        result.leases;
                    if (!removed) return;
                    this.logger.info(
                        `[stats] pruned ${result.daily} daily, ${result.tracks} tracks, ${result.listeners} listeners, ${result.userTracks} per-user tracks, ${result.leases} expired leases`
                    );
                })
                .catch(error => this.logger.warn(`[stats] retention job failed: ${error}`));
        };
        run();
        const timer = setInterval(run, intervalHours * 60 * 60 * 1000);
        timer.unref();
    }

    public async reloadCommands(): Promise<number> {
        await installCommands(this, true);
        return this.commands.size;
    }

    private async publicNodes(): Promise<NodeOption[]> {
        try {
            const best = await findBestPublicNode(this.config.publicNodeListUrl);
            if (!best) {
                this.logger.warn(
                    '[nodes] no public Lavalink node answered the probe; starting without a node'
                );
                return [];
            }
            this.logger.info(
                `[nodes] using public node ${best.entry.identifier} (${best.latencyMs}ms, ${best.players} players)`
            );
            return [toNodeOption(best.entry)];
        } catch (error) {
            this.logger.error(`[nodes] public node lookup failed: ${error}`);
            return [];
        }
    }
}
