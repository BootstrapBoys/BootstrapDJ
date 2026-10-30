import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';

export default class NodeError extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeError',
        });
    }
    public async run(node: string, error: any): Promise<void> {
        this.client.logger.error(`Node ${node} Error: ${JSON.stringify(error)}`);
        BotLog.send(this.client, `Node ${node} Error: ${JSON.stringify(error)}`, 'error');
    }
}
