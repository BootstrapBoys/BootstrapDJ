import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { describeCloseCode, noteDestroy, resetDestroyCount } from '../../utils/NodeStatus.js';

export default class NodeDestroy extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeDestroy',
        });
    }
    public async run(node: string, code: number, reason: string): Promise<void> {
        const info = describeCloseCode(code);
        const detail = reason?.trim() ? ` — ${reason.trim()}` : '';
        const message = `Lavalink node "${node}" disconnected: ${info.summary} (code ${code})${detail}.${
            info.expected
                ? ' The bot reconnects automatically.'
                : ' Check that Lavalink is running and reachable.'
        }`;

        if (info.expected) this.client.logger.warn(message);
        else this.client.logger.error(message);
        BotLog.send(this.client, message, info.expected ? 'warn' : 'error');

        if (noteDestroy() >= 5) {
            resetDestroyCount();
            this.client.shoukaku.removeNode(node);
            const removed = `Lavalink node "${node}" removed after 5 disconnects without a successful reconnect.`;
            this.client.logger.warn(removed);
            BotLog.send(this.client, removed, 'warn');
        }
    }
}
