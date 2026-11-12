import type { BootstrapClient } from '../../core/index.js';
import { Event } from '../../core/index.js';
import { DEFAULT_LANGUAGE, translate } from '../../lib/i18n.js';
import BotLog from '../../lib/BotLog.js';
import { isPrimaryNode } from '../../lib/NodeConfig.js';
import { endIncident, formatDuration } from '../../lib/NodeStatus.js';
import { isFallbackNode } from '../../lib/PublicNodes.js';

export default class NodeConnect extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'nodeConnect' });
    }

    private configuredNames(): string[] {
        return this.client.config.lavalink.map(option => option.name);
    }

    private isStandby(node: string): boolean {
        const configured = this.configuredNames();
        return (
            !isFallbackNode(node) && configured.includes(node) && !isPrimaryNode(node, configured)
        );
    }

    private report(node: string): void {
        if (isFallbackNode(node)) {
            this.client.logger.warn(
                `Public fallback node "${node}" is handling playback — the configured nodes are still down.`
            );
            return;
        }
        const copy = (key: string, variables: Record<string, string | number> = {}): string =>
            translate(
                `longtail:events.nodes.${key}`,
                this.client.config.defaultLanguage ?? DEFAULT_LANGUAGE,
                variables
            );
        const recoveredMs = endIncident(node);
        const message =
            recoveredMs === null
                ? copy('ready', { node })
                : copy('recovered', {
                      node,
                      duration: formatDuration(recoveredMs),
                  });
        this.client.logger.success(message);
        BotLog.send(this.client, message, 'success');
    }

    private switchBack(node: string): void {
        const target = this.client.shoukaku.nodes.get(node);
        if (!target) return;
        this.client.queue.holdPositions();
        void this.client.queue
            .migrateToNode(target)
            .then(moved => {
                if (moved) {
                    this.client.logger.success(
                        `[nodes] moved ${moved} player(s) back to "${node}"`
                    );
                }
            })
            .catch(error =>
                this.client.logger.error(`[nodes] switch-back migration failed: ${error}`)
            );
    }

    private async rejoin247(guildId: string): Promise<void> {
        const guild = this.client.guilds.cache.get(guildId);
        const bot = this.client.user;
        if (!guild || !bot) return;

        const stay = await this.client.db.get_247(guildId);
        const row = Array.isArray(stay) ? stay[0] : stay;
        if (!row) return;
        const text = guild.channels.cache.get(row.textId);
        const voice = guild.channels.cache.get(row.voiceId);
        if (!text || !voice) return;

        const lease = await this.client.db.getSessionLease(guildId).catch(() => null);
        if (lease && lease.expiresAt.getTime() > Date.now() && lease.botId !== bot.id) return;
        if (!lease && !(await this.client.preferredBotStatus(guildId)).allowed) return;

        const claimed = await this.client.db
            .claimSessionLease(guildId, bot.id, this.client.config.botName || bot.username, 60_000)
            .catch(() => false);
        if (!claimed) return;

        if (
            !this.client.queue.has(guildId) &&
            (await this.client.db.getSession(guildId).catch(() => null))
        ) {
            await this.client.db.releaseSessionLease(guildId, bot.id).catch(() => {});
            return;
        }

        try {
            await this.client.queue.create(guild, voice, text);
        } catch (error) {
            if (!this.client.queue.has(guildId)) {
                await this.client.db.releaseSessionLease(guildId, bot.id).catch(() => {});
            }
            this.client.logger.warn(`[nodes] 24/7 rejoin failed for ${guild.id}: ${error}`);
        }
    }

    public async run(node: string): Promise<void> {
        if (this.isStandby(node)) {
            this.client.logger.info(`[nodes] standby node "${node}" is ready`);
            return;
        }
        this.report(node);
        this.switchBack(node);

        const rows = await this.client.db.get_247();
        if (!rows) return;
        const entries = Array.isArray(rows) ? rows : [rows];
        for (const [index, entry] of entries.entries()) {
            setTimeout(() => void this.rejoin247(entry.guildId), index * 1000);
        }
    }
}
