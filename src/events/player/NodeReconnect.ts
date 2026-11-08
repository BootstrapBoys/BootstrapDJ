import { BootstrapClient, Event } from '../../core/index.js';
import BotLog from '../../lib/BotLog.js';
import { isPrimaryNode } from '../../lib/NodeConfig.js';
import { endIncident, formatDuration } from '../../lib/NodeStatus.js';
import { isFallbackNode } from '../../lib/PublicNodes.js';

export default class NodeReconnect extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeReconnect',
        });
    }
    public async run(node: string): Promise<void> {
        const configured = this.client.config.lavalink.map(option => option.name);
        if (!isFallbackNode(node) && configured.includes(node) && !isPrimaryNode(node, configured)) {
            this.client.logger.info(`[nodes] standby node "${node}" reconnected`);
            return;
        }

        if (isFallbackNode(node)) {
            const message = `Public fallback node "${node}" reconnected — the configured nodes are still down.`;
            this.client.logger.warn(message);
            return;
        }

        const recoveredMs = endIncident();
        const message =
            recoveredMs === null
                ? `Lavalink node "${node}" reconnected.`
                : `Lavalink node "${node}" recovered after ${formatDuration(recoveredMs)}.`;
        this.client.logger.success(message);
        BotLog.send(this.client, message, 'success');
    }
}
