import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import {
    describeCloseCode,
    noteDestroy,
    openQuietWindow,
    resetDestroyCount,
} from '../../utils/NodeStatus.js';

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

        if (info.expected) {
            // One message per restart: the socket errors that follow belong to
            // this same shutdown and are demoted to debug by NodeError.
            openQuietWindow();
            this.client.logger.warn(message);
            BotLog.send(this.client, message, 'warn');
        } else {
            this.client.logger.error(message);
            BotLog.send(this.client, message, 'error');
        }

        if (noteDestroy() >= 5) {
            resetDestroyCount();
            this.client.shoukaku.removeNode(node);
            const removed = `Lavalink node "${node}" removed after 5 disconnects without a successful reconnect.`;
            this.client.logger.warn(removed);
            BotLog.send(this.client, removed, 'warn');
        }
    }
}
