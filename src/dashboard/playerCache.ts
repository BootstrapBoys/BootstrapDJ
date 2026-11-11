import type { DashboardHost } from './host.js';

type PlayerState = Awaited<ReturnType<DashboardHost['player']>>;
type CacheEntry = { at: number; data: PlayerState };

export interface PlayerStateCacheOptions {
    refreshMs?: number;
    staleMaxMs?: number;
}

/**
 * Guild-scoped player snapshot cache for the dashboard's high-frequency reads.
 *
 * The snapshot is identical for every viewer in a guild, so sharing one
 * refresh collapses N browser polls into one bot/control read. Stale entries
 * are served immediately while a single background refresh runs; explicit
 * invalidations prevent a mutation from being hidden by the cache.
 */
export class PlayerStateCache {
    private readonly cache = new Map<string, CacheEntry>();
    private readonly inFlight = new Map<string, Promise<PlayerState>>();
    private readonly generation = new Map<string, number>();
    private readonly refreshMs: number;
    private readonly staleMaxMs: number;

    public constructor(options: PlayerStateCacheOptions = {}) {
        this.refreshMs = options.refreshMs ?? 1_000;
        this.staleMaxMs = options.staleMaxMs ?? 10_000;
    }

    public invalidate(guildId: string): void {
        this.generation.set(guildId, (this.generation.get(guildId) ?? 0) + 1);
        this.cache.delete(guildId);
    }

    public async read(host: DashboardHost, guildId: string): Promise<PlayerState> {
        const now = Date.now();
        const cached = this.cache.get(guildId);
        if (cached) {
            if (now - cached.at >= this.refreshMs) this.refresh(host, guildId);
            if (now - cached.at < this.staleMaxMs) return cached.data;
        }
        return await this.fetch(host, guildId);
    }

    private refresh(host: DashboardHost, guildId: string): void {
        if (this.inFlight.has(guildId)) return;
        void this.fetch(host, guildId).catch(() => {
            // Keep the last good snapshot; the next read retries.
        });
    }

    private fetch(host: DashboardHost, guildId: string): Promise<PlayerState> {
        const existing = this.inFlight.get(guildId);
        if (existing) return existing;

        const generation = this.generation.get(guildId) ?? 0;
        const request = host
            .player(guildId)
            .then(data => {
                if ((this.generation.get(guildId) ?? 0) === generation) {
                    this.cache.set(guildId, { at: Date.now(), data });
                }
                return data;
            })
            .finally(() => {
                if (this.inFlight.get(guildId) === request) this.inFlight.delete(guildId);
            });
        this.inFlight.set(guildId, request);
        return request;
    }
}
