/** Owns the dispatcher's recurring and delayed timers so teardown is explicit. */
export class PlaybackTimers {
    public pause: ReturnType<typeof setTimeout> | null = null;
    public idle: ReturnType<typeof setTimeout> | null = null;

    public clearPause(): void {
        if (this.pause) clearTimeout(this.pause);
        this.pause = null;
    }

    public clearIdle(): void {
        if (this.idle) clearTimeout(this.idle);
        this.idle = null;
    }

    public clearAll(): void {
        this.clearPause();
        this.clearIdle();
    }
}
