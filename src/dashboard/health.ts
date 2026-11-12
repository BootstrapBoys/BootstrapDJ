import type { BootstrapClient } from '../core/index.js';
import type { DashboardHealth } from './host.js';

/** Shoukaku encodes the only playable state as CONNECTED = 1. */
const CONNECTED = 1;

/**
 * Cheap readiness snapshot for the public `/health` endpoint.
 *
 * `ok` requires a logged-in gateway client, at least one connected Lavalink
 * node and a database that answers. The response deliberately carries counts
 * and booleans only: no guild ids, user ids, node names or credentials.
 */
export async function collectHealth(client: BootstrapClient): Promise<DashboardHealth> {
    const nodes = [...client.shoukaku.nodes.values()];
    const connected = nodes.filter(node => Number(node.state) === CONNECTED).length;
    const database = await client.db.ping().catch(() => false);
    const botReady = client.isReady();
    const ok = botReady && database && connected > 0;

    return {
        ok,
        status: ok ? 'ok' : 'degraded',
        botReady,
        database,
        uptimeSec: Math.round(process.uptime()),
        guilds: client.guilds.cache.size,
        players: client.queue.size,
        nodes: { connected, total: nodes.length },
        checkedAt: new Date().toISOString(),
    };
}
