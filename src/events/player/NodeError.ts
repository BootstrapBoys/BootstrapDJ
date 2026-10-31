import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { formatNodeError, isQuietWindow } from '../../utils/NodeStatus.js';

export default class NodeError extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeError',
        });
    }
    public async run(node: string, error: unknown): Promise<void> {
        const detail = formatNodeError(error);
        const hint =
            detail === 'no details from the server'
                ? 'no details were provided by the server — check the Lavalink logs with `pm2 logs Lavalink`'
                : `${detail} — check the Lavalink logs with \`pm2 logs Lavalink\``;
        const message = `Lavalink node "${node}" connection error: ${hint}.`;

        if (isQuietWindow()) {
            // NodeError fires while the node is mid-restart; the user already
            // has the clean 'restarting' warning, so keep this out of Discord.
            this.client.logger.debug(message);
            return;
        }

        this.client.logger.error(message);
        BotLog.send(this.client, message, 'error');
    }
}
