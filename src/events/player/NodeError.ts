import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { beginIncident, formatDuration, formatNodeError, takeReminder } from '../../utils/NodeStatus.js';

export default class NodeError extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeError',
        });
    }
    public async run(node: string, error: unknown): Promise<void> {
        const detail = formatNodeError(error);
        const reason =
            detail === 'no details from the server'
                ? 'no details were provided by the server — check `pm2 logs Lavalink`'
                : `${detail} — check \`pm2 logs Lavalink\``;

        const incident = beginIncident();
        if (!incident.started) {
            const reminderMs = this.client.config.nodeAlertReminderMinutes * 60_000;
            if (takeReminder(reminderMs)) {
                const reminder = `Lavalink node "${node}" is still unreachable after ${formatDuration(
                    incident.durationMs
                )}: ${reason}.`;
                this.client.logger.warn(reminder);
                BotLog.send(this.client, reminder, 'warn');
            } else {
                this.client.logger.debug(
                    `[nodes] retry failed (${formatDuration(incident.durationMs)}): ${reason}`
                );
            }
            return;
        }

        const message = `Lavalink node "${node}" is unreachable: ${reason}. Retrying in the background — one message will follow when it recovers.`;
        this.client.logger.error(message);
        BotLog.send(this.client, message, 'error');
    }
}
