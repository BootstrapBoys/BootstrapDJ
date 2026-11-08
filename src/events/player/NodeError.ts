import type { BootstrapClient } from '../../core/index.js';
import { Event } from '../../core/index.js';
import BotLog from '../../lib/BotLog.js';
import { isPrimaryNode } from '../../lib/NodeConfig.js';
import {
    beginIncident,
    formatDuration,
    formatNodeError,
    takeReminder,
} from '../../lib/NodeStatus.js';
import { isFallbackNode } from '../../lib/PublicNodes.js';

export default class NodeError extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'nodeError' });
    }

    private reason(error: unknown): string {
        const detail = formatNodeError(error);
        return detail === 'no details from the server'
            ? 'no details were provided by the server — check `pm2 logs Lavalink`'
            : `${detail} — check \`pm2 logs Lavalink\``;
    }

    public async run(node: string, error: unknown): Promise<void> {
        const detail = formatNodeError(error);
        const configured = this.client.config.lavalink.map(option => option.name);
        if (
            !isFallbackNode(node) &&
            configured.includes(node) &&
            !isPrimaryNode(node, configured)
        ) {
            this.client.logger.debug(`[nodes] standby node "${node}" error: ${detail}`);
            return;
        }
        if (isFallbackNode(node)) {
            this.client.logger.debug(`[nodes] public fallback "${node}" error: ${detail}`);
            return;
        }

        const incident = beginIncident();
        if (!incident.started) {
            if (takeReminder(this.client.config.nodeAlertReminderMinutes * 60_000)) {
                const reminder = `Lavalink node "${node}" is still unreachable after ${formatDuration(
                    incident.durationMs
                )}: ${this.reason(error)}.`;
                this.client.logger.warn(reminder);
                BotLog.send(this.client, reminder, 'warn');
            } else {
                this.client.logger.debug(
                    `[nodes] retry failed (${formatDuration(incident.durationMs)}): ${this.reason(error)}`
                );
            }
            return;
        }

        const message = `Lavalink node "${node}" is unreachable: ${this.reason(
            error
        )}. Retrying in the background.`;
        this.client.logger.error(message);
        BotLog.send(this.client, message, 'error');
    }
}
