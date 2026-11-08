import type { Song } from '../Dispatcher.js';

export interface FailureDecision {
    key: string;
    failures: number;
    drop: boolean;
}

/** Count a failed play; the third failure drops the track instead of requeueing
 * it forever and blocking the rest of the queue. */
export function recordPlayFailure(
    current: Song,
    failedTracks: Map<string, number>
): FailureDecision {
    const key = current.info?.uri ?? current.encoded;
    const failures = (failedTracks.get(key) ?? 0) + 1;
    if (failures >= 3) {
        failedTracks.delete(key);
    } else {
        failedTracks.set(key, failures);
    }
    return { key, failures, drop: failures >= 3 };
}
