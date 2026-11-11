import type { ServerResponse } from 'node:http';

import type { DashboardHost } from './host.js';
import { PlayerStateCache } from './playerCache.js';

type EventClient = {
    id: number;
    userId: string;
    res: ServerResponse;
};

export interface PlayerEventHubOptions {
    updateMs?: number;
    heartbeatMs?: number;
    maxClientsPerGuild?: number;
}

/**
 * Guild-scoped SSE fan-out for player snapshots.
 *
 * Every viewer in a guild subscribes to the same snapshot source. The cache
 * performs one upstream read per refresh window; the hub broadcasts only when
 * the snapshot actually changes and sends periodic comments to keep proxies
 * from idling the connection.
 */
export class PlayerEventHub {
    private readonly clients = new Map<string, Set<EventClient>>();
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private readonly heartbeats = new Map<string, NodeJS.Timeout>();
    private readonly last = new Map<string, string>();
    private readonly updateMs: number;
    private readonly heartbeatMs: number;
    private readonly maxClientsPerGuild: number;
    private nextId = 1;

    public constructor(
        private readonly cache: PlayerStateCache,
        options: PlayerEventHubOptions = {}
    ) {
        this.updateMs = options.updateMs ?? 2_000;
        this.heartbeatMs = options.heartbeatMs ?? 15_000;
        this.maxClientsPerGuild = options.maxClientsPerGuild ?? 100;
    }

    public canAttach(guildId: string): boolean {
        return (this.clients.get(guildId)?.size ?? 0) < this.maxClientsPerGuild;
    }

    public attach(host: DashboardHost, guildId: string, userId: string, res: ServerResponse): void {
        let clients = this.clients.get(guildId);
        if (!clients) {
            clients = new Set();
            this.clients.set(guildId, clients);
        }
        const client: EventClient = { id: this.nextId++, userId, res };
        clients.add(client);

        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
        });
        res.write('retry: 2000\n\n');

        const snapshot = this.last.get(guildId);
        if (snapshot) res.write(`data: ${snapshot}\n\n`);
        void this.refresh(host, guildId);
        this.ensureTimers(host, guildId);

        const cleanup = (): void => {
            const current = this.clients.get(guildId);
            if (current) {
                current.delete(client);
                if (!current.size) this.stopTimers(guildId);
            }
        };
        res.once('close', cleanup);
        res.on('error', cleanup);
    }

    private ensureTimers(host: DashboardHost, guildId: string): void {
        if (!this.timers.has(guildId)) {
            const timer = setInterval(() => void this.refresh(host, guildId), this.updateMs);
            timer.unref();
            this.timers.set(guildId, timer);
        }
        if (!this.heartbeats.has(guildId)) {
            const heartbeat = setInterval(() => {
                this.broadcast(guildId, ': ping\n\n');
            }, this.heartbeatMs);
            heartbeat.unref();
            this.heartbeats.set(guildId, heartbeat);
        }
    }

    private stopTimers(guildId: string): void {
        const timer = this.timers.get(guildId);
        if (timer) clearInterval(timer);
        const heartbeat = this.heartbeats.get(guildId);
        if (heartbeat) clearInterval(heartbeat);
        this.timers.delete(guildId);
        this.heartbeats.delete(guildId);
        this.clients.delete(guildId);
        this.last.delete(guildId);
    }

    private async refresh(host: DashboardHost, guildId: string): Promise<void> {
        try {
            const data = await this.cache.read(host, guildId);
            const payload = JSON.stringify({ player: data.player });
            if (this.last.get(guildId) === payload) return;
            this.last.set(guildId, payload);
            this.broadcast(guildId, `data: ${payload}\n\n`);
        } catch {
            // Keep the last snapshot; the next tick retries.
        }
    }

    private broadcast(guildId: string, chunk: string): void {
        const clients = this.clients.get(guildId);
        if (!clients) return;
        for (const client of clients) {
            try {
                if (client.res.writableEnded) {
                    clients.delete(client);
                    continue;
                }
                client.res.write(chunk);
            } catch {
                clients.delete(client);
            }
        }
        if (!clients.size) this.stopTimers(guildId);
    }
}
