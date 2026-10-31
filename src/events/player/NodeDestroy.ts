import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { beginIncident, describeCloseCode, formatDuration } from '../../utils/NodeStatus.js';

export default class NodeDestroy extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeDestroy',
        });
    }
    public async run(node: string, code: number, reason: string): Promise<void> {
        const info = describeCloseCode(code);
        const detail = reason?.trim() ? ` — ${reason.trim()}` : '';
        const incident = beginIncident();

        if (!incident.started) {
            this.client.logger.debug(
                `[nodes] still down (${formatDuration(incident.durationMs)}): ${info.summary} (code ${code})`
            );
            return;
        }

        const message = `Lavalink node "${node}" is down: ${info.summary} (code ${code})${detail}. Retrying in the background — one message will follow when it recovers.`;
        if (info.expected) this.client.logger.warn(message);
        else this.client.logger.error(message);
        BotLog.send(this.client, message, info.expected ? 'warn' : 'error');
    }
}
