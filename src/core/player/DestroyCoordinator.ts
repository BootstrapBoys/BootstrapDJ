import type { PlaybackLoggerPort } from './PlaybackEngine.js';
import { PlaybackTimers } from './PlaybackTimers.js';

/** Everything teardown needs from its dispatcher, without owning its state. */
export interface DestroyHost {
    readonly guildId: string;
    readonly stopped: boolean;
    readonly timers: PlaybackTimers;
    isCurrent(): boolean;
    isShuttingDown(): boolean;
    isIdle(): boolean;
    stopNowPlayingCollector(): void;
    clearNowPlayingCommandMessages(): void;
    clearQueueEmptyPrompt(): void;
    resetPlayback(): void;
    deleteSession(): Promise<void>;
    leave(): Promise<void>;
    removeFromQueue(): void;
    updateStatus(): void;
    emitPlayerDestroy(): void;
}

/**
 * Owns teardown ordering: timer and collector cleanup, session delete vs
 * preserve, voice leave, queue removal and the playerDestroy event. A stale
 * dispatcher may clean up its own resources but must never leave voice or tear
 * down the replacement player that now owns the guild.
 */
export class DestroyCoordinator {
    private leavePromise: Promise<void> | null = null;

    public constructor(
        private readonly host: DestroyHost,
        private readonly logger: PlaybackLoggerPort
    ) {}

    public destroy(preserveSession: boolean = false): void {
        // A delayed timer or collector may still hold the old dispatcher after
        // a rebuild installed a replacement; never tear down the live player.
        if (!this.host.isCurrent()) {
            this.host.timers.clearPersist();
            this.host.timers.clearStats();
            this.host.timers.clearPause();
            this.host.timers.clearIdle();
            this.host.stopNowPlayingCollector();
            this.host.clearNowPlayingCommandMessages();
            this.host.clearQueueEmptyPrompt();
            return;
        }
        if (this.host.isShuttingDown()) {
            this.host.timers.clearPersist();
            this.host.timers.clearStats();
            this.host.clearQueueEmptyPrompt();
            return;
        }
        this.host.timers.clearAll();
        this.host.stopNowPlayingCollector();
        this.host.clearNowPlayingCommandMessages();
        this.host.clearQueueEmptyPrompt();
        if (!preserveSession) void this.host.deleteSession();
        this.host.resetPlayback();
        this.leavePromise = (async () => {
            try {
                await this.host.leave();
            } catch (error) {
                this.logger.warn(`[player] leave failed for ${this.host.guildId}: ${error}`);
            }
        })();
        this.host.removeFromQueue();
        this.host.updateStatus();
        if (this.host.stopped) return;
        this.host.emitPlayerDestroy();
    }

    /**
     * Destroy and wait for Lavalink to remove the old player. A rebuild that
     * joins before this settles can have its new player deleted by the old
     * leave request, leaving the queue populated but silent.
     */
    public async destroyAndWait(preserveSession: boolean = false): Promise<void> {
        this.destroy(preserveSession);
        await this.leavePromise;
    }

    public armIdleTimeout(seconds: number): void {
        this.clearIdleTimeout();
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        this.host.timers.idle = setTimeout(() => {
            this.host.timers.idle = null;
            if (this.host.isIdle()) this.destroy();
        }, seconds * 1000);
        (this.host.timers.idle as unknown as { unref?: () => void }).unref?.();
    }

    public clearIdleTimeout(): void {
        this.host.timers.clearIdle();
    }

    public armPauseTimeout(seconds: number, onElapsed: () => void): void {
        this.host.timers.pause = setTimeout(onElapsed, seconds * 1000);
        (this.host.timers.pause as unknown as { unref?: () => void }).unref?.();
    }

    public clearPauseTimeout(): void {
        this.host.timers.clearPause();
    }
}
