/**
 * Active browser audio listeners, keyed by guild.
 *
 * The dashboard sidecar owns the real stream count and reports it through the
 * loopback control API. The bot keeps this map so voice cleanup can tell the
 * difference between "nobody in Discord voice" and "nobody anywhere".
 */
const counts = new Map<string, number>();

/** Set the current listener count; returns the normalized count. */
export function setDashboardListenerCount(guildId: string, count: number): number {
    const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (normalized === 0) counts.delete(guildId);
    else counts.set(guildId, normalized);
    return normalized;
}

export function getDashboardListenerCount(guildId: string): number {
    return counts.get(guildId) ?? 0;
}

export function clearDashboardListeners(): void {
    counts.clear();
}
