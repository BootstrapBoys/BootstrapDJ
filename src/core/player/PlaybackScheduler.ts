/**
 * One process-wide timer for periodic player persistence.
 *
 * Each dispatcher used to own its own interval. That scales with guild count
 * even when most players are idle. This scheduler keeps one unref'd interval
 * and only asks active players to persist when their deadline is due.
 */
export interface ScheduledPlayer {
    readonly guildId: string;
    readonly exists: boolean;
    readonly paused: boolean;
    readonly current: unknown;
    readonly queue: { readonly length: number };
    persist(): Promise<void>;
}

const TICK_MS = 1_000;
const PERSIST_INTERVAL_MS = 10_000;

export class PlaybackScheduler {
    private readonly players = new Map<string, { player: ScheduledPlayer; nextPersist: number }>();
    private timer: NodeJS.Timeout | null = null;

    public register(player: ScheduledPlayer): void {
        this.players.set(player.guildId, {
            player,
            nextPersist: Date.now() + PERSIST_INTERVAL_MS,
        });
        this.ensureTimer();
    }

    public unregister(guildId: string, player?: ScheduledPlayer): void {
        const entry = this.players.get(guildId);
        if (!entry) return;
        if (player && entry.player !== player) return;
        this.players.delete(guildId);
        this.stopIfEmpty();
    }

    /** Public for deterministic tests; the interval calls it with Date.now(). */
    public tick(now: number = Date.now()): void {
        for (const [guildId, entry] of this.players) {
            if (!entry.player.exists) {
                this.players.delete(guildId);
                continue;
            }
            if (now < entry.nextPersist) continue;
            entry.nextPersist = now + PERSIST_INTERVAL_MS;
            if (!entry.player.paused && (entry.player.current || entry.player.queue.length)) {
                void entry.player.persist().catch(() => {});
            }
        }
        this.stopIfEmpty();
    }

    private ensureTimer(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick(), TICK_MS);
        this.timer.unref();
    }

    private stopIfEmpty(): void {
        if (this.players.size > 0 || !this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }
}
