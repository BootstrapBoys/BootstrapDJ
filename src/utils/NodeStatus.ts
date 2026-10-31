/**
 * Human-readable Lavalink node failures.
 *
 * Shoukaku hands us raw WebSocket close codes and whatever error object the
 * server sent — frequently `{}`. A normal Lavalink restart (1001) used to be
 * posted to the log channel as "destroyed with code 1001 and reason", which
 * reads like a crash even though the bot reconnects by itself.
 */

export interface CloseCodeInfo {
    summary: string;
    /** True when the server is expected to come back without intervention. */
    expected: boolean;
}

export function describeCloseCode(code: number): CloseCodeInfo {
    switch (code) {
        case 1000:
            return { summary: 'the node closed the connection normally', expected: true };
        case 1001:
            return { summary: 'the node is restarting or shutting down', expected: true };
        case 1005:
            return { summary: 'the node closed without sending a reason', expected: false };
        case 1006:
            return {
                summary: 'the connection dropped without a close frame (network, crash, or firewall)',
                expected: false,
            };
        case 1011:
            return { summary: 'the node hit an internal error', expected: false };
        case 1012:
            return { summary: 'the node is restarting', expected: true };
        case 1013:
            return { summary: 'the node asked us to retry later', expected: true };
        default:
            if (code >= 4000) return { summary: 'the node closed with a custom code', expected: false };
            return { summary: 'the connection closed unexpectedly', expected: false };
    }
}

/** Turn whatever Shoukaku passed as `error` into a sentence worth reading. */
export function formatNodeError(error: unknown): string {
    if (error instanceof Error) return error.message || error.name;
    if (!error || typeof error !== 'object') {
        return typeof error === 'string' && error.trim() ? error.trim() : 'no details from the server';
    }

    const record = error as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.message === 'string' && record.message.trim()) parts.push(record.message.trim());
    if (typeof record.code === 'string' || typeof record.code === 'number') parts.push(`code ${record.code}`);
    if (typeof record.cause === 'string' && record.cause.trim()) parts.push(record.cause.trim());

    return parts.length ? parts.join(', ') : 'no details from the server';
}

let destroyCount = 0;
let quietUntil = 0;

/** An expected close (restart/shutdown) opens a window where follow-up socket
 * errors are part of the same event and should not be posted separately. */
export function openQuietWindow(seconds: number = 90): void {
    quietUntil = Date.now() + seconds * 1000;
}

export function isQuietWindow(): boolean {
    return Date.now() < quietUntil;
}

export function noteDestroy(): number {
    destroyCount += 1;
    return destroyCount;
}

export function resetDestroyCount(): void {
    destroyCount = 0;
}
