import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';

export default class NodeReconnect extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeReconnect',
        });
    }
    public async run(node: string): Promise<void> {
        const message = `Lavalink node "${node}" reconnected.`;
        this.client.logger.success(message);
        BotLog.send(this.client, message, 'success');
    }
}
