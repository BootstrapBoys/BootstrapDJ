import { Constants } from 'shoukaku';

import { BootstrapClient } from '../../core/index.js';
import BotLog from '../../lib/BotLog.js';
import { formatDuration } from '../../lib/NodeStatus.js';
import {
    findBestPublicNode,
    isFallbackNode,
    shouldFallback,
    toNodeOption,
} from '../../lib/PublicNodes.js';
import { BotPlugin } from '../index.js';

const CHECK_INTERVAL_MS = 30_000;
const PROBE_COOLDOWN_MS = 60_000;

/**
 * Watchdog for Lavalink availability:
 * - re-adds operator nodes while the primary is down,
 * - moves stranded players onto a connected standby,
 * - probes the public list only after the configured outage delay,
 * - removes the public fallback once the primary is healthy and drained.
 */
const reconnectNodes: BotPlugin = {
    name: 'Node Watchdog',
    version: '1.1.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        let fallbackName: string | null = null;
        let downSince = 0;
        let probing = false;
        let announced = false;
        let lastProbeAt = 0;
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

        const dropDeadFallback = (): void => {
            if (!fallbackName) return;
            const node = client.shoukaku.nodes.get(fallbackName);
            if (node && node.state !== Constants.State.DISCONNECTED) return;
            if (node) {
                try {
                    client.shoukaku.removeNode(fallbackName, 'fallback disconnected');
                } catch (error) {
                    client.logger.debug(`[nodes] could not remove fallback ${fallbackName}: ${error}`);
                }
            }
            fallbackName = null;
        };

        const reAddConfigured = (): void => {
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
        };

        const migrateStranded = (): void => {
            if (primaryUp() || !client.queue.hasNode) return;
            const target = client.queue.node;
            const stranded = [...client.queue.values()].some(
                dispatcher => dispatcher.player.node?.name !== target?.name
            );
            if (stranded && target) {
                void client.queue
                    .migrateToNode(target)
                    .catch(error => client.logger.error(`[nodes] migration retry failed: ${error}`));
            }
        };

        const announceStandby = (): boolean => {
            if (!client.queue.hasNode) return false;
            const active = client.queue.node?.name;
            if (active && !isFallbackNode(active) && !announced) {
                const message = `Primary node is down — standby node "${active}" is handling playback.`;
                client.logger.warn(message);
                BotLog.send(client, message, 'warn');
                announced = true;
            }
            return true;
        };

        const probePublic = (): void => {
            if (probing || !client.config.nodeFallback) return;
            if (Date.now() - lastProbeAt < PROBE_COOLDOWN_MS) return;
            if (!shouldFallback(Date.now() - downSince, client.config.nodeFallbackAfter, fallbackName !== null)) {
                return;
            }
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
                    if (!announced) {
                        BotLog.send(client, message, 'warn');
                        announced = true;
                    }
                } catch (error) {
                    client.logger.error(`[nodes] public fallback failed: ${error}`);
                } finally {
                    probing = false;
                }
            })();
        };

        const timer = setInterval(() => {
            if (!client.isReady()) return;
            dropDeadFallback();
            if (primaryUp()) {
                downSince = 0;
                announced = false;
                dropIdleFallback();
                return;
            }
            if (!downSince) downSince = Date.now();
            reAddConfigured();
            migrateStranded();
            if (announceStandby()) return;
            probePublic();
        }, CHECK_INTERVAL_MS);

        (timer as unknown as { unref?: () => void }).unref?.();
    },
};

export default reconnectNodes;
