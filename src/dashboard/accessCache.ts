import type { GuildAccess } from './shardApi.js';

/**
 * Short-lived cache of per-viewer guild rights.
 *
 * Discord role changes are not pushed to us, so a TTL is the background
 * refresh. Mutating routes bypass the cache and invalidate the guild's entries
 * afterwards; a cached object is always copied so a caller cannot mutate the
 * rights that a later request will read.
 */
export class GuildAccessCache {
    private readonly entries = new Map<string, { at: number; access: GuildAccess }>();

    public constructor(
        private readonly ttlMs: number,
        private readonly maxEntries: number,
        private readonly now: () => number = Date.now
    ) {}

    public get(key: string): GuildAccess | null {
        const entry = this.entries.get(key);
        if (!entry) return null;
        if (this.now() - entry.at >= this.ttlMs) {
            this.entries.delete(key);
            return null;
        }
        return { ...entry.access };
    }

    public set(key: string, access: GuildAccess): void {
        this.entries.set(key, { at: this.now(), access: { ...access } });
        this.prune();
    }

    /** Drop every cached viewer for one guild (all sessions and token mode). */
    public invalidateGuild(guildId: string): void {
        const suffix = `:${guildId}`;
        for (const key of this.entries.keys()) {
            if (key.endsWith(suffix)) this.entries.delete(key);
        }
    }

    public clear(): void {
        this.entries.clear();
    }

    public get size(): number {
        return this.entries.size;
    }

    private prune(): void {
        const now = this.now();
        for (const [key, entry] of this.entries) {
            if (now - entry.at >= this.ttlMs) this.entries.delete(key);
        }
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next();
            if (oldest.done) break;
            this.entries.delete(oldest.value);
        }
    }
}
