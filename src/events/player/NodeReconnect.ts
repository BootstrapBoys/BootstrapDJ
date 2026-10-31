import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { endIncident, formatDuration } from '../../utils/NodeStatus.js';

export default class NodeReconnect extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeReconnect',
        });
    }
    public async run(node: string): Promise<void> {
        const recoveredMs = endIncident();
        const message =
            recoveredMs === null
                ? `Lavalink node "${node}" reconnected.`
                : `Lavalink node "${node}" recovered after ${formatDuration(recoveredMs)}.`;
        this.client.logger.success(message);
        BotLog.send(this.client, message, 'success');
    }
}
