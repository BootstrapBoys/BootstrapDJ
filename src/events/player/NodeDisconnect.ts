import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { isQuietWindow } from '../../utils/NodeStatus.js';

export default class NodeDisconnect extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeDisconnect',
        });
    }
    public async run(node: string, count: number): Promise<void> {
        const message = `Lost connection to Lavalink node "${
            node
        }" (${count} reconnect attempt${count === 1 ? '' : 's'} so far) — retrying.`;
        if (isQuietWindow()) return;
        this.client.logger.warn(message);
        BotLog.send(this.client, message, 'warn');
    }
}
