import type { EarlCommandHandler, EarlSetupRefresher } from '../types.js';
import {
    ApplicationCommandType,
    Client,
    ClientOptions,
    Collection,
    EmbedBuilder,
    Events,
    Interaction,
    PermissionsBitField,
    REST,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    Routes,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodeOption } from 'shoukaku';


import { Command, Queue, ShoukakuClient } from './index.js';
import Logger from './Logger.js';
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
import ServerData from '../database/server.js';
import loadPlugins from '../plugin/index.js';
import { loadBots } from '../utils/BotsFile.js';
import { findBestPublicNode, toNodeOption } from '../utils/PublicNodes.js';
import { Utils } from '../utils/Utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Shared control IDs used by the setup mock and /nowplaying responses. */
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
    public logger: Logger = new Logger();
    public readonly color = config.color;
    private body: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
    public shoukaku!: ShoukakuClient;
    public utils = Utils;
    public queue = new Queue(this);
    /** True while the process is doing a graceful shutdown; don't erase saved sessions. */
    public shuttingDown = false;
    /** Installed by the Earl plugin so the coordinator shard can execute a
     * voice command on the shard that actually owns the guild. */
    public earlCommand?: EarlCommandHandler;
    public earlRefreshSetup?: EarlSetupRefresher;
    private statsMaintenanceStarted = false;
    public constructor(options: ClientOptions) {
        super(options);
    }

    /** True when this process owns global singletons. In a sharded deployment
     * only shard 0 does; the BOTS_FILE launcher marks its first child. */
    public get isCoordinator(): boolean {
        if (this.shard) return this.shard.ids.includes(0);
        if (this.config.botsFile) return this.config.botCoordinator;
        return true;
    }

    /** Serializable helpers used by the coordinator dashboard through
     * shard.broadcastEval. Keep these free of class instances and closures. */
    public dashboardLocalGuildIds(): string[] {
        return [...this.guilds.cache.keys()];
    }

    public dashboardLocalGuilds(userId: string | null): Promise<DashboardGuild[]> {
        return dashboardGuilds(this, userId);
    }

    public dashboardLocalAccess(userId: string | null, guildId: string): Promise<AccessResult> {
        return guildAccessFor(this, userId, guildId);
    }

    public dashboardLocalPlayer(guildId: string): { found: boolean; player: PlayerSnapshot | null } {
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
    public async start(token: string): Promise<void> {
        if (this.config.lavalink.length > 0) {
            this.shoukaku = new ShoukakuClient(this, this.config.lavalink);
        } else if (this.config.autoNode) {
            const nodes = await this.getNodes();
            this.shoukaku = new ShoukakuClient(this, nodes);
        } else {
            this.shoukaku = new ShoukakuClient(this, []);
        }
        await this.db
            .initialize()
            .catch(error => this.logger.warn(`[db] SQLite initialization failed: ${error}`));
        this.startStatsMaintenance();
        await this.loadCommands();
        this.logger.info(`Successfully loaded commands!`);
        await this.loadEvents();
        this.logger.info(`Successfully loaded events!`);
        await loadPlugins(this);
        await this.login(token);
        if (this.config.botsFile && this.user) {
            const beat = (): void => {
                void this.db
                    .heartbeatBot(this.user!.id, this.config.botName || this.user!.username)
                    .catch(() => {});
            };
            beat();
            const timer = setInterval(beat, 30_000);
            (timer as unknown as { unref?: () => void }).unref?.();
        }
        startDashboard(this);
        this.on(Events.InteractionCreate, async (interaction: Interaction): Promise<void> => {
            if (!interaction.isButton() || !interaction.guildId) return;
            if (interaction.message?.author?.id !== this.user?.id) return;
            // The setup mock and /nowplaying both use the same control IDs.
            if (CONTROL_BUTTON_IDS.has(interaction.customId)) {
                this.emit('setupButtons', interaction);
            }
        });
    }

    /** Which configured bot should own voice in this guild. Falls back to
     * allowing the caller when no other bot has a fresh heartbeat. */
    public async preferredBotStatus(guildId: string): Promise<{ allowed: boolean; name: string | null }> {
        if (!this.config.botsFile || !this.user) return { allowed: true, name: null };
        let bots;
        try {
            bots = loadBots(this.config.botsFile);
        } catch {
            return { allowed: true, name: null };
        }
        if (bots.length <= 1) return { allowed: true, name: null };
        // A live session lease is authoritative across the fleet. Without this
        // check the old preferred order keeps routing to a bot that has already
        // handed the session off (or away from the bot that adopted it).
        const lease = await this.db.getSessionLease(guildId).catch(() => null);
        if (lease && lease.expiresAt.getTime() > Date.now()) {
            return lease.botId === this.user.id
                ? { allowed: true, name: lease.botName }
                : { allowed: false, name: lease.botName };
        }
        const guild = this.guilds.cache.get(guildId);
        if (!guild) return { allowed: true, name: null };
        for (const bot of bots) {
            if (bot.clientId === this.user.id) {
                return { allowed: true, name: bot.name };
            }
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
                        result.daily + result.tracks + result.listeners + result.userTracks + result.leases;
                    if (removed > 0) {
                        this.logger.info(
                            `[stats] pruned ${result.daily} daily, ${result.tracks} tracks, ${result.listeners} listeners, ${result.userTracks} per-user tracks, ${result.leases} expired leases`
                        );
                    }
                })
                .catch(error => this.logger.warn(`[stats] retention job failed: ${error}`));
        };
        run();
        const timer = setInterval(run, intervalHours * 60 * 60 * 1000);
        (timer as unknown as { unref?: () => void }).unref?.();
    }

    private async loadCommands(): Promise<void> {
        const commandsPath = fs.readdirSync(path.join(__dirname, '../commands'));
        const pending: Array<Promise<void>> = [];
        for (const dir of commandsPath) {
            const commandFiles = fs
                .readdirSync(path.join(__dirname, `../commands/${dir}`))
                .filter(file => file.endsWith('.js'));
            for (const file of commandFiles) pending.push(this.registerCommand(dir, file));
        }
        // Registration must finish before `ready` builds the slash-command body.
        await Promise.all(pending);
        this.once(Events.ClientReady, async () => {
            const userId = this.user?.id;
            if (!userId) return;
            const shardedNonCoordinator = Boolean(this.shard) && !this.isCoordinator;
            const registrationRoutes =
                this.config.production === true
                    ? shardedNonCoordinator
                        ? []
                        : [Routes.applicationCommands(userId)]
                    : [...this.guilds.cache.keys()].map(guildId => Routes.applicationGuildCommands(userId, guildId));
            if (!this.config.production && !registrationRoutes.length && !shardedNonCoordinator) {
                if (this.guilds.cache.has(this.config.guildId)) {
                    registrationRoutes.push(Routes.applicationGuildCommands(userId, this.config.guildId));
                }
            }
            if (!registrationRoutes.length && shardedNonCoordinator) {
                this.logger.info('[slash] no command routes for this shard');
                return;
            }
            try {
                // Discord accepts at most 100 top-level chat-input commands.
                // Group related commands or mark them prefix-only before this
                // guard; truncating silently would hide a parity regression.
                if (this.body.length > 100) {
                    this.logger.error(
                        `[slash] ${this.body.length} commands exceed Discord's 100-command limit; only the first 100 will register.`
                    );
                    this.body = this.body.slice(0, 100);
                }
                const rest = new REST({ version: '10' }).setToken(this.config.token ?? '');
                if (this.config.production !== true && (!this.shard || this.isCoordinator)) {
                    // Commands registered globally by a previous deployment linger
                    // in the guild command picker alongside guild commands. Clear
                    // the global scope when running in test/guild mode.
                    const globalCommands = Routes.applicationCommands(userId);
                    const existing = (await rest.get(globalCommands)) as unknown[];
                    if (Array.isArray(existing) && existing.length > 0) {
                        await rest.put(globalCommands, { body: [] });
                        this.logger.info(`[slash] cleared ${existing.length} stale global commands`);
                    }
                }
                for (const route of registrationRoutes) {
                    await rest.put(route, { body: this.body });
                }
                this.logger.info(`Successfully loaded slash commands in ${registrationRoutes.length} guild(s)!`);
            } catch (error) {
                this.logger.error(error);
            }
        });
    }

    private async registerCommand(dir: string, file: string, cacheBust: boolean = false): Promise<void> {
        const cmd = (await import(`../commands/${dir}/${file}${cacheBust ? `?update=${Date.now()}` : ''}`)).default;
        const command: Command = new cmd(this);
        command.category = dir;
        this.commands.set(command.name, command);
        if (command.aliases.length !== 0) {
            command.aliases.forEach(alias => {
                this.aliases.set(alias, command.name);
            });
        }
        if (!command.slashCommand) return;
        const data: RESTPostAPIChatInputApplicationCommandsJSONBody = {
            name: command.name,
            description: command.description.content ?? command.name,
            type: ApplicationCommandType.ChatInput,
            ...(command.options.length
                ? { options: command.options as unknown as RESTPostAPIChatInputApplicationCommandsJSONBody['options'] }
                : {}),
            ...(command.nameLocalizations
                ? { name_localizations: command.nameLocalizations }
                : {}),
            ...(command.descriptionLocalizations
                ? { description_localizations: command.descriptionLocalizations }
                : {}),
        };
        if (command.permissions.user.length > 0) {
            const permissionValue = PermissionsBitField.resolve(command.permissions.user);
            data.default_member_permissions =
                typeof permissionValue === 'bigint' ? permissionValue.toString() : permissionValue;
        }
        this.body.push(data);
    }

    /** Reload command modules without restarting the process. Slash metadata is
     * not re-registered here; restart the process if option schemas changed. */
    public async reloadCommands(): Promise<number> {
        this.commands.clear();
        this.aliases.clear();
        const commandsPath = fs.readdirSync(path.join(__dirname, '../commands'));
        const pending: Array<Promise<void>> = [];
        for (const dir of commandsPath) {
            const commandFiles = fs
                .readdirSync(path.join(__dirname, `../commands/${dir}`))
                .filter(file => file.endsWith('.js'));
            for (const file of commandFiles) pending.push(this.registerCommand(dir, file, true));
        }
        await Promise.all(pending);
        return this.commands.size;
    }

    private async getNodes(): Promise<NodeOption[]> {
        try {
            const best = await findBestPublicNode(this.config.publicNodeListUrl);
            if (!best) {
                this.logger.warn('[nodes] no public Lavalink node answered the probe; starting without a node');
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

    private async loadEvents(): Promise<void> {
        const eventsPath = fs.readdirSync(path.join(__dirname, '../events'));
        const pending: Array<Promise<void>> = [];
        for (const dir of eventsPath) {
            const events = fs
                .readdirSync(path.join(__dirname, `../events/${dir}`))
                .filter(file => file.endsWith('.js'));
            for (const file of events) pending.push(this.registerEvent(dir, file));
        }
        // Must be registered before login, or a fast gateway connect misses them.
        await Promise.all(pending);
    }

    private async registerEvent(dir: string, file: string): Promise<void> {
        const event = (await import(`../events/${dir}/${file}`)).default;
        const evt = new event(this, file);
        // EventEmitter does not await handlers, so a rejected event used to
        // become an unhandled rejection and restart the bot via antiCrash.
        // Log the failed event instead; genuine uncaught exceptions still exit.
        const dispatch = (...args: unknown[]): void => {
            void Promise.resolve()
                .then(() => evt.run(...args))
                .catch(error => this.logger.error(`[event] ${evt.name} failed: ${error}`));
        };
        if (dir === 'player') {
            this.shoukaku.on(evt.name, dispatch);
        } else {
            this.on(evt.name, dispatch);
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
