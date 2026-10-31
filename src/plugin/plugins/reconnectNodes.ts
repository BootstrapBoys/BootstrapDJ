import { Constants } from 'shoukaku';

import { BootstrapClient } from '../../structures/index.js';
import { BotPlugin } from '../index.js';

const CHECK_INTERVAL_MS = 30_000;

/**
 * After a reboot the bot can win the race against Lavalink, exhaust Shoukaku's
 * reconnect tries and then sit with no node until someone restarts it by hand.
 * This watchdog re-adds any configured node that is missing or disconnected.
 */
const reconnectNodes: BotPlugin = {
    name: 'Node Watchdog',
    version: '1.0.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        const timer = setInterval(() => {
            if (client.queue.hasNode) return;

            for (const option of client.config.lavalink) {
                if (!option.url) continue;
                const existing = client.shoukaku.nodes.get(option.name);
                if (existing && existing.state !== Constants.State.DISCONNECTED) continue;

                try {
                    if (existing) client.shoukaku.removeNode(option.name, 'watchdog');
                    client.shoukaku.addNode(option);
                    client.logger.warn(`[nodes] no connected node — re-adding ${option.name}`);
                } catch (error) {
                    client.logger.error(`[nodes] could not re-add ${option.name}: ${error}`);
                }
            }
        }, CHECK_INTERVAL_MS);

        (timer as unknown as { unref?: () => void }).unref?.();
    },
};

export default reconnectNodes;
