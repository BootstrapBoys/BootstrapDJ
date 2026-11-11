/**
 * Keep a long-lived stream bounded by the current guild access result.
 *
 * The check runs on a fixed lease. A transient check failure leaves the stream
 * alive; only an explicit `false` (membership lost) invokes the revocation
 * callback.
 */
export function startAccessLease(
    check: () => Promise<boolean>,
    onRevoked: () => void,
    intervalMs: number = 60_000
): NodeJS.Timeout {
    let settled = false;
    const timer = setInterval(() => {
        if (settled) return;
        void check()
            .then(allowed => {
                if (!allowed && !settled) {
                    settled = true;
                    clearInterval(timer);
                    onRevoked();
                }
            })
            .catch(() => {
                // The next lease retries; access failures are not revocations.
            });
    }, intervalMs);
    timer.unref();
    return timer;
}
