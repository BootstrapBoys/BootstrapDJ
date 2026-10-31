import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { beginIncident, describeCloseCode, formatDuration } from '../../utils/NodeStatus.js';
import { isFallbackNode, markFallbackFailed } from '../../utils/PublicNodes.js';

export default class NodeDestroy extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeDestroy',
        });
    }
    public async run(node: string, code: number, reason: string): Promise<void> {
        if (isFallbackNode(node)) {
            markFallbackFailed(node);
            this.client.logger.debug(
                `[nodes] public fallback "${node}" closed: code ${code}${reason?.trim() ? ` (${reason.trim()})` : ''}`
            );
            const message = `Public fallback node "${node}" was lost — trying another node.`;
            this.client.logger.warn(message);
            return;
        }

        const info = describeCloseCode(code);
        const detail = reason?.trim() ? ` — ${reason.trim()}` : '';
        const incident = beginIncident();

        if (!incident.started) {
            this.client.logger.debug(
                `[nodes] still down (${formatDuration(incident.durationMs)}): ${info.summary} (code ${code})`
            );
            return;
        }

        const message = `Lavalink node "${node}" is down: ${info.summary} (code ${code})${detail}. Retrying in the background.`;
        if (info.expected) this.client.logger.warn(message);
        else this.client.logger.error(message);
        BotLog.send(this.client, message, info.expected ? 'warn' : 'error');
    }
}
