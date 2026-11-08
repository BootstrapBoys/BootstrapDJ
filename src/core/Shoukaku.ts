import { EventEmitter } from 'node:events';
import { Connectors, NodeOption, Shoukaku } from 'shoukaku';
import type { Node } from 'shoukaku';

import { nodePriority } from '../lib/NodeConfig.js';
import { BootstrapClient } from './index.js';

/**
 * Shoukaku 4.x encodes connection state as a number; only CONNECTED = 1 can
 * accept players. Reading the exported enum at runtime is not possible (it is
 * type-only), so the numeric contract is pinned here.
 */
const CONNECTED = 1;

function preferConnected(client: BootstrapClient, nodes: Map<string, Node>): Node | undefined {
    const configuredOrder = client.config.lavalink.map(node => node.name);
    const candidates = [...nodes.values()].filter(node => Number(node.state) === CONNECTED);
    candidates.sort(
        (left, right) =>
            nodePriority(left.name, configuredOrder) - nodePriority(right.name, configuredOrder) ||
            left.penalties - right.penalties
    );
    return candidates[0];
}

export default class ShoukakuClient extends Shoukaku {
    public client: BootstrapClient;

    public constructor(client: BootstrapClient, nodes: NodeOption[]) {
        super(new Connectors.DiscordJS(client), nodes, {
            moveOnDisconnect: false,
            resume: false,
            reconnectInterval: 10,
            reconnectTries: 20,
            restTimeout: 30_000,
            // NAME/VERSION only: several public nodes reject other user agents.
            userAgent: 'BootstrapDJ/4.1.0 (https://github.com/zebz213/BootstrapDJ)',
            nodeResolver: pool => preferConnected(client, pool),
        });
        this.client = client;
        this.forwardLifecycle();
    }

    private forwardLifecycle(): void {
        this.on('ready', (name, reconnected) =>
            this.client.shoukaku.emitPlayerEvent(reconnected ? 'nodeReconnect' : 'nodeConnect', name)
        );
        this.on('error', (name, error) =>
            this.client.shoukaku.emitPlayerEvent('nodeError', name, error)
        );
        this.on('close', (name, code, reason) =>
            this.client.shoukaku.emitPlayerEvent('nodeDestroy', name, code, reason)
        );
        this.on('disconnect', (name, count) =>
            this.client.shoukaku.emitPlayerEvent('nodeDisconnect', name, count)
        );
        this.on('debug', (name, reason) =>
            this.client.shoukaku.emitPlayerEvent('nodeRaw', name, reason)
        );
    }

    /**
     * Shoukaku's event map is closed, so bot lifecycle events (trackStart,
     * queueEnd, playerCreate, nodeConnect...) are emitted through the base
     * EventEmitter contract instead of casting at every call site.
     */
    public emitPlayerEvent(event: string, ...args: unknown[]): boolean {
        return EventEmitter.prototype.emit.call(this, event, ...args);
    }
}
