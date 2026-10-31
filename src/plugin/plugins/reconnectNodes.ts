import { Constants } from 'shoukaku';

import { BootstrapClient } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { formatDuration } from '../../utils/NodeStatus.js';
import {
    findBestPublicNode,
    isFallbackNode,
    shouldFallback,
    toNodeOption,
} from '../../utils/PublicNodes.js';
import { BotPlugin } from '../index.js';

const CHECK_INTERVAL_MS = 30_000;
const PROBE_COOLDOWN_MS = 60_000;

/**
 * Keeps a node available: re-adds the operator's own node when it drops, and
 * after NODE_FALLBACK_AFTER seconds of continuous outage probes the public
 * list for a usable fallback. Once the primary is back, new players go to it
 * (lowest penalty) and the fallback is removed when its players drain.
 */
const reconnectNodes: BotPlugin = {
    name: 'Node Watchdog',
    version: '1.1.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        let fallbackName: string | null = null;
        let downSince = 0;
        let probing = false;
        let fallbackAnnounced = false;
        let lastProbeAt = 0;

        // The primary specifically — a connected standby must NOT count, or we
        // stop re-adding the primary and never return to it.
        const primaryName = client.config.lavalink[0]?.name;
        const primaryUp = (): boolean =>
            Boolean(primaryName) &&
            [...client.shoukaku.nodes.values()].some(
                node => node.state === Constants.State.CONNECTED && node.name === primaryName
            );

        const dropIdleFallback = (): void => {
            if (!fallbackName) return;
            const node = client.shoukaku.nodes.get(fallbackName);
            if (node && (node.stats?.players ?? 0) > 0) return;

            try {
                client.shoukaku.removeNode(fallbackName, 'primary restored');
            } catch (error) {
                client.logger.error(`[nodes] could not remove fallback ${fallbackName}: ${error}`);
            }
            const message = `A configured Lavalink node is back — removed public fallback "${fallbackName}".`;
            client.logger.success(message);
            BotLog.send(client, message, 'success');
            fallbackName = null;
        };

        const timer = setInterval(() => {
            if (!client.isReady()) return;

            // A dead public node must leave the map, otherwise Shoukaku keeps
            // retrying it and every attempt logs another destroy.
            const fallbackNode = fallbackName ? client.shoukaku.nodes.get(fallbackName) : null;
            if (fallbackName && (!fallbackNode || fallbackNode.state === Constants.State.DISCONNECTED)) {
                if (fallbackNode) {
                    try {
                        client.shoukaku.removeNode(fallbackName, 'fallback disconnected');
                    } catch (error) {
                        client.logger.debug(`[nodes] could not remove fallback ${fallbackName}: ${error}`);
                    }
                }
                fallbackName = null;
            }

            if (primaryUp()) {
                downSince = 0;
                fallbackAnnounced = false;
                dropIdleFallback();
                return;
            }

            if (!downSince) downSince = Date.now();

            // 1. keep trying the operator's own nodes, even while a standby or
            // public fallback is serving playback
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

            // If the primary is down but players are still bound to it, move
            // them onto the standby that is serving (retry each tick until the
            // rebuild succeeds; failures log their reason).
            if (!primaryUp() && client.queue.hasNode) {
                const target = client.queue.node;
                const stranded = [...client.queue.values()].some(
                    dispatcher => dispatcher.player.node?.name !== target?.name
                );
                if (stranded && target) {
                    void client.queue
                        .migrateToNode(target)
                        .catch(error => client.logger.error(`[nodes] migration retry failed: ${error}`));
                }
            }

            // A configured standby is serving; tell the channel once per outage
            // (the public fallback already announces itself when it is added).
            if (client.queue.hasNode) {
                const active = client.queue.node?.name;
                if (active && !isFallbackNode(active) && !fallbackAnnounced) {
                    const announced = `Primary node is down — standby node "${active}" is handling playback.`;
                    client.logger.warn(announced);
                    BotLog.send(client, announced, 'warn');
                    fallbackAnnounced = true;
                }
                return;
            }

            // 2. public fallback once the outage is long enough
            if (probing) return;
            if (!client.config.nodeFallback) return;
            if (Date.now() - lastProbeAt < PROBE_COOLDOWN_MS) return;
            if (!shouldFallback(Date.now() - downSince, client.config.nodeFallbackAfter, fallbackName !== null))
                return;

            probing = true;
            lastProbeAt = Date.now();
            void (async () => {
                try {
                    const best = await findBestPublicNode(client.config.publicNodeListUrl);
                    if (!best) {
                        client.logger.warn('[nodes] no public fallback answered the probe');
                        return;
                    }
                    const option = toNodeOption(best.entry);
                    client.shoukaku.addNode(option);
                    fallbackName = option.name;
                    const message = `Primary node still down after ${formatDuration(
                        Date.now() - downSince
                    )} — using public fallback "${option.name}" (${best.latencyMs}ms, ${best.players} players).`;
                    client.logger.warn(message);
                    // One notice per outage: later candidates are console-only,
                    // otherwise a flaky public list turns into Discord spam.
                    if (!fallbackAnnounced) {
                        BotLog.send(client, message, 'warn');
                        fallbackAnnounced = true;
                    }
                } catch (error) {
                    client.logger.error(`[nodes] public fallback failed: ${error}`);
                } finally {
                    probing = false;
                }
            })();
        }, CHECK_INTERVAL_MS);

        (timer as unknown as { unref?: () => void }).unref?.();
    },
};

export default reconnectNodes;
