import type BootstrapClient from '../BootstrapClient.js';

export type ListenerStatsRow = {
    userId: string;
    seconds: number;
    deafSeconds: number;
};

type PendingRow = ListenerStatsRow & { guildId: string };

const SAMPLE_INTERVAL_MS = 60_000;
const MAX_PENDING = 5_000;

/**
 * Collects listener-time samples in memory and writes all guilds in one
 * transaction per minute. The old path opened one transaction per guild and
 * repeated that work for every active dispatcher.
 */
export class ListenerStatsBatcher {
    private readonly pending = new Map<string, PendingRow>();
    private timer: NodeJS.Timeout | null = null;
    private flushInFlight: Promise<void> | null = null;

    public start(client: BootstrapClient): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.collect(client), SAMPLE_INTERVAL_MS);
        this.timer.unref();
    }

    public stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    public pendingCount(): number {
        return this.pending.size;
    }

    public add(guildId: string, rows: ListenerStatsRow[]): void {
        for (const row of rows) {
            if (!row.userId || row.seconds <= 0) continue;
            const key = `${guildId}:${row.userId}`;
            const current = this.pending.get(key);
            if (current) {
                current.seconds += row.seconds;
                current.deafSeconds += row.deafSeconds;
            } else if (this.pending.size < MAX_PENDING) {
                this.pending.set(key, { guildId, ...row });
            }
        }
    }

    /** Sample every active player, then flush the accumulated rows. */
    public collect(client: BootstrapClient): void {
        for (const player of client.queue.values()) {
            this.add(player.guildId, player.listenerStatsRows());
        }
        void this.flush(client);
    }

    public async flush(client: BootstrapClient): Promise<void> {
        if (this.flushInFlight) return await this.flushInFlight;
        if (!this.pending.size) return;
        const rows = [...this.pending.values()];
        this.pending.clear();
        const request = client.db.recordListenerStatsBatch(rows).catch(() => {
            // A failed transaction committed nothing; keep the samples for the
            // next minute instead of silently losing them.
            for (const row of rows) this.add(row.guildId, [row]);
        });
        this.flushInFlight = request;
        try {
            await request;
        } finally {
            if (this.flushInFlight === request) this.flushInFlight = null;
        }
    }
}
