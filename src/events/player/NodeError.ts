import type { BootstrapClient } from '../../core/index.js';
import { Event } from '../../core/index.js';
import { DEFAULT_LANGUAGE, translate } from '../../lib/i18n.js';
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

    private copy(key: string, variables: Record<string, string | number> = {}): string {
        return translate(
            `longtail:events.nodes.${key}`,
            this.client.config.defaultLanguage ?? DEFAULT_LANGUAGE,
            variables
        );
    }

    private reason(error: unknown): string {
        const detail = formatNodeError(error);
        return detail === 'no details from the server'
            ? this.copy('noDetails')
            : this.copy('withDetails', { detail });
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

        const incident = beginIncident(node);
        if (!incident.started) {
            if (takeReminder(node, this.client.config.nodeAlertReminderMinutes * 60_000)) {
                const reminder = this.copy('reminder', {
                    node,
                    duration: formatDuration(incident.durationMs),
                    reason: this.reason(error),
                });
                this.client.logger.warn(reminder);
                BotLog.send(this.client, reminder, 'warn');
            } else {
                this.client.logger.debug(
                    `[nodes] retry failed (${formatDuration(incident.durationMs)}): ${this.reason(error)}`
                );
            }
            return;
        }

        const message = this.copy('unreachable', {
            node,
            reason: this.reason(error),
        });
        this.client.logger.error(message);
        BotLog.send(this.client, message, 'error');
    }
}
