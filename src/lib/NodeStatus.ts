/**
 * Lavalink node health: readable close codes, readable errors, and an incident
 * model so a long outage produces one message instead of one per retry.
 *
 * Shoukaku hands us raw WebSocket close codes and whatever error object the
 * server sent — frequently `{}`. A normal restart (1001) used to be posted as
 * "destroyed with code 1001 and reason", which reads like a crash.
 */

export interface CloseCodeInfo {
    summary: string;
    /** True when the server is expected to come back without intervention. */
    expected: boolean;
}

export interface IncidentStatus {
    /** True only for the call that actually opened the incident. */
    started: boolean;
    durationMs: number;
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
                summary:
                    'the connection dropped without a close frame (network, crash, or firewall)',
                expected: false,
            };
        case 1011:
            return { summary: 'the node hit an internal error', expected: false };
        case 1012:
            return { summary: 'the node is restarting', expected: true };
        case 1013:
            return { summary: 'the node asked us to retry later', expected: true };
        default:
            if (code >= 4000)
                return { summary: 'the node closed with a custom code', expected: false };
            return { summary: 'the connection closed unexpectedly', expected: false };
    }
}

/** Turn whatever Shoukaku passed as `error` into a sentence worth reading. */
export function formatNodeError(error: unknown): string {
    if (error instanceof Error) return error.message || error.name;
    if (!error || typeof error !== 'object') {
        return typeof error === 'string' && error.trim()
            ? error.trim()
            : 'no details from the server';
    }

    const record = error as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.message === 'string' && record.message.trim())
        parts.push(record.message.trim());
    if (typeof record.code === 'string' || typeof record.code === 'number')
        parts.push(`code ${record.code}`);
    if (typeof record.cause === 'string' && record.cause.trim()) parts.push(record.cause.trim());

    return parts.length ? parts.join(', ') : 'no details from the server';
}

export function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

interface NodeIncident {
    startedAt: number;
    lastNoticeAt: number;
}

/**
 * Incidents are per node. A single module-global incident let a standby or a
 * NodeError suppress the primary's later NodeDestroy alert and failover.
 */
const incidents = new Map<string, NodeIncident>();

export function beginIncident(node: string, now: number = Date.now()): IncidentStatus {
    const existing = incidents.get(node);
    if (existing) return { started: false, durationMs: now - existing.startedAt };
    incidents.set(node, { startedAt: now, lastNoticeAt: now });
    return { started: true, durationMs: 0 };
}

export function isIncidentActive(node: string): boolean {
    return incidents.has(node);
}

/** True at most once per interval, so a long outage gets one reminder, not spam. */
export function takeReminder(node: string, reminderMs: number, now: number = Date.now()): boolean {
    const incident = incidents.get(node);
    if (!incident || reminderMs <= 0) return false;
    if (now - incident.lastNoticeAt < reminderMs) return false;
    incident.lastNoticeAt = now;
    return true;
}

/** Returns how long that node's outage lasted, or null when it had none. */
export function endIncident(node: string, now: number = Date.now()): number | null {
    const incident = incidents.get(node);
    if (!incident) return null;
    incidents.delete(node);
    return now - incident.startedAt;
}

export function resetNodeStatus(): void {
    incidents.clear();
}
