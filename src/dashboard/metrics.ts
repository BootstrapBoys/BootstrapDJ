import { monitorEventLoopDelay } from 'node:perf_hooks';

import type { BootstrapClient } from '../core/index.js';

/**
 * Event-loop lag is cumulative between samples. The dashboard resets it after
 * each read so a 30-second poll reports the window it actually covers.
 */
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

function resourceCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const name of process.getActiveResourcesInfo()) {
        counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
}

/** Internal process/player sample consumed by the soak runner. */
export function collectMetrics(client: BootstrapClient): Record<string, unknown> {
    const memory = process.memoryUsage();
    const players = [...client.queue.values()].map(player => ({
        guildId: player.guildId,
        playing: Boolean(player.current),
        paused: player.paused,
        queue: player.queue.length,
        autoplay: player.autoplay,
        loop: player.loop,
    }));

    const snapshot = {
        at: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        guilds: client.guilds.cache.size,
        players,
        memory: {
            rss: memory.rss,
            heapUsed: memory.heapUsed,
            heapTotal: memory.heapTotal,
            external: memory.external,
            arrayBuffers: memory.arrayBuffers,
        },
        eventLoop: {
            p50: eventLoop.percentile(50) / 1e6,
            p95: eventLoop.percentile(95) / 1e6,
            p99: eventLoop.percentile(99) / 1e6,
            max: eventLoop.max / 1e6,
        },
        resources: resourceCounts(),
        wsPing: client.ws.ping,
    };

    eventLoop.reset();
    return snapshot;
}
