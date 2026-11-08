import { BootstrapClient, Event } from '../../core/index.js';
import BotLog from '../../lib/BotLog.js';
import { beginIncident, formatDuration } from '../../lib/NodeStatus.js';

export default class NodeDisconnect extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'nodeDisconnect' });
    }

    public async run(node: string, count: number): Promise<void> {
        const incident = beginIncident();
        if (!incident.started) {
            this.client.logger.debug(
                `[nodes] disconnect #${count} (${formatDuration(incident.durationMs)} into the outage)`
            );
            return;
        }
        const message = `Lost connection to Lavalink node "${node}" (attempt ${count}) — retrying in the background.`;
        this.client.logger.warn(message);
        BotLog.send(this.client, message, 'warn');
    }
}
