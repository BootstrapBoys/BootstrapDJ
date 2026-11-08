import type { Song } from '../Dispatcher.js';
import { trackKey, trackSignature } from './TrackIdentity.js';

/** Recent explicit requests kept as independent seed lanes. Newest is drawn
 * most often; the pool is additive and capped so a long session doesn't turn
 * into a bag of unrelated artists. */
export const AUTOPLAY_SEEDS = 3;
const AUTOPLAY_SEED_LANE_WEIGHTS = [3, 2, 1];

export interface SeedState {
    seeds: Song[];
    seed: Song | null;
    current: Song | null;
    queue: Song[];
    history: Song[];
}

function addUnique(
    target: Song[],
    seen: Set<string>,
    track: Song | null | undefined,
    includeAutoplay = false
): void {
    if (!track?.info?.author) return;
    if (track.autoplay && !includeAutoplay) return;
    const signature = trackSignature(track) || trackKey(track);
    if (!signature || seen.has(signature)) return;
    seen.add(signature);
    target.push(track);
}

/** Explicit seed lanes, newest first. A restored session has no persisted
 * pool, so fall back to unplayed user requests in current/queue/history
 * rather than treating the last bot pick as the user's intent. */
export function buildSeedPool(state: SeedState): Song[] {
    const pool: Song[] = [];
    const seen = new Set<string>();

    for (const track of state.seeds ?? []) addUnique(pool, seen, track, true);
    if (!state.seeds?.length) {
        addUnique(pool, seen, state.seed, true);
        addUnique(pool, seen, state.current);
        for (const track of state.queue) addUnique(pool, seen, track);
        for (const track of state.history) addUnique(pool, seen, track);
    }
    return pool.slice(0, AUTOPLAY_SEEDS);
}

/** Seed candidates for one lookahead. The first lane is a weighted draw from
 * the explicit pool; the rest are fallbacks if its mix is unavailable. */
export function buildSeedCandidates(
    state: SeedState,
    explicit: Song | undefined,
    shuffle: <T>(items: T[]) => T[]
): Song[] {
    const pool = buildSeedPool(state);
    const seen = new Set<string>();
    const candidates: Song[] = [];
    const add = (track?: Song | null): void => {
        if (!track?.info?.author) return;
        const signature = trackSignature(track) || trackKey(track);
        if (!signature || seen.has(signature)) return;
        seen.add(signature);
        candidates.push(track);
    };

    add(explicit);
    if (pool.length) {
        const weighted: Song[] = [];
        pool.forEach((track, index) => {
            const weight = AUTOPLAY_SEED_LANE_WEIGHTS[index] ?? 1;
            for (let i = 0; i < weight; i++) weighted.push(track);
        });
        add(weighted[Math.floor(Math.random() * weighted.length)]);
        for (const track of shuffle(pool)) add(track);
    } else {
        add(state.seed);
        add(state.current);
        for (const track of state.history.slice(-5)) add(track);
    }
    return candidates;
}
