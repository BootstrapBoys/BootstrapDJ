/**
 * Process-local performance counters for low-overhead operational visibility.
 *
 * These are cumulative since process start and are intentionally plain integers:
 * no labels, no allocation per observation, and no external metrics dependency.
 */
export const performanceCounters = {
    sessionWrites: 0,
    sessionWritesSkipped: 0,
    sessionErrors: 0,
    statsBatches: 0,
    statsRows: 0,
    statsErrors: 0,
    autoplaySearches: 0,
    autoplayCacheHits: 0,
    autoplayCacheMisses: 0,
    autoplayCoalesced: 0,
    dashboardPlayerRequests: 0,
};

export type PerformanceCounter = keyof typeof performanceCounters;

export function incrementCounter(counter: PerformanceCounter, amount: number = 1): void {
    if (amount > 0) performanceCounters[counter] += amount;
}

export function performanceSnapshot(): Record<PerformanceCounter, number> {
    return { ...performanceCounters };
}
