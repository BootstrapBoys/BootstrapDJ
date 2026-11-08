/** Owns the dispatcher's recurring and delayed timers so teardown is explicit. */
export class PlaybackTimers {
    public persist: ReturnType<typeof setInterval> | null = null;
    public stats: ReturnType<typeof setInterval> | null = null;
    public pause: ReturnType<typeof setTimeout> | null = null;
    public idle: ReturnType<typeof setTimeout> | null = null;

    public clearPersist(): void {
        if (this.persist) clearInterval(this.persist);
        this.persist = null;
    }

    public clearStats(): void {
        if (this.stats) clearInterval(this.stats);
        this.stats = null;
    }

    public clearPause(): void {
        if (this.pause) clearTimeout(this.pause);
        this.pause = null;
    }

    public clearIdle(): void {
        if (this.idle) clearTimeout(this.idle);
        this.idle = null;
    }

    public clearAll(): void {
        this.clearPersist();
        this.clearStats();
        this.clearPause();
        this.clearIdle();
    }
}
