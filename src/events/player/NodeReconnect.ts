import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { endIncident, formatDuration } from '../../utils/NodeStatus.js';
import { isFallbackNode } from '../../utils/PublicNodes.js';

export default class NodeReconnect extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeReconnect',
        });
    }
    public async run(node: string): Promise<void> {
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
