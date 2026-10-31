import { Connectors, NodeOption, Shoukaku } from 'shoukaku';

import { BootstrapClient } from './index.js';
import { nodePriority } from '../utils/NodeConfig.js';


/**
 * Shoukaku 4.x State: CONNECTING = 0, CONNECTED = 1, DISCONNECTING = 2,
 * DISCONNECTED = 3. The enum is exported as a type only, so it cannot be read
 * at runtime; the previous filter on `2` selected DISCONNECTING nodes and made
 * every lookup report "no node available" while the node was healthy.
 */
const NODE_CONNECTED = 1;

export default class ShoukakuClient extends Shoukaku {
    public client: BootstrapClient;
    constructor(client: BootstrapClient, nodes: NodeOption[]) {
        super(new Connectors.DiscordJS(client), nodes, {
            moveOnDisconnect: false,
            resume: false,
            reconnectInterval: 10,
            reconnectTries: 20,
            restTimeout: 30000,
            userAgent: `BootstrapDJ/4.1.0 (https://github.com/zebz213/BootstrapDJ)`, // NAME/VERSION form; some public nodes reject others
            nodeResolver: nodes => {
                const configured = client.config.lavalink.map(node => node.name);
                return [...nodes.values()]
                    .filter(node => Number(node.state) === NODE_CONNECTED)
                    .sort(
                        (a, b) =>
                            nodePriority(a.name, configured) - nodePriority(b.name, configured) ||
                            a.penalties - b.penalties
                    )
                    .shift();
            },
        });
        this.client = client;
        this.on('ready', (name, reconnected) => {
            this.client.shoukaku.emitPlayerEvent(reconnected ? 'nodeReconnect' : 'nodeConnect', name);
        });

        this.on('error', (name, error) => this.client.shoukaku.emitPlayerEvent('nodeError', name, error));

        this.on('close', (name, code, reason) =>
            this.client.shoukaku.emitPlayerEvent('nodeDestroy', name, code, reason)
        );
        this.on('disconnect', (name, count) => {
            this.client.shoukaku.emitPlayerEvent('nodeDisconnect', name, count);
        });

        this.on('debug', (name, reason) => this.client.shoukaku.emitPlayerEvent('nodeRaw', name, reason));
    }

    /**
     * Shoukaku's event map is a closed type, so the bot's own player lifecycle
     * events (trackStart, queueEnd, playerCreate, nodeConnect...) are emitted
     * through this wrapper instead of casting at every call site.
     */
    public emitPlayerEvent(event: string, ...args: unknown[]): boolean {
        return (this.emit as (eventName: string, ...rest: unknown[]) => boolean)(event, ...args);
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
