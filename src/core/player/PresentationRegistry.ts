import type { Message } from 'discord.js';

/** Track-scoped `/nowplaying` replies and their cleanup timers. */
export class PresentationRegistry {
    private readonly messages = new Map<Message, NodeJS.Timeout | null>();

    public register(message: Message, durationMs: number | null): void {
        this.remove(message);
        const timer =
            durationMs === null
                ? null
                : setTimeout(
                      () => this.remove(message),
                      Math.min(Math.max(durationMs + 30_000, 15_000), 12 * 60 * 60 * 1000)
                  );
        (timer as unknown as { unref?: () => void })?.unref?.();
        this.messages.set(message, timer);
    }

    public has(messageId: string): boolean {
        for (const message of this.messages.keys()) {
            if (message.id === messageId) return true;
        }
        return false;
    }

    public clear(): void {
        for (const [message, timer] of Array.from(this.messages)) {
            if (timer) clearTimeout(timer);
            this.messages.delete(message);
            void message.delete().catch(() => {});
        }
    }

    private remove(message: Message): void {
        if (!this.messages.has(message)) return;
        const timer = this.messages.get(message);
        if (timer) clearTimeout(timer);
        this.messages.delete(message);
        void message.delete().catch(() => {});
    }
}
