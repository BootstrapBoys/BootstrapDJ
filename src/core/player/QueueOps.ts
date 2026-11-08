import type { Song } from '../Dispatcher.js';
import { AUTOPLAY_SEEDS } from './AutoplaySeeds.js';
import { normalizeAuthor, trackKey, trackSignature } from './TrackIdentity.js';

/** Round-robin queued tracks by requester so one user cannot occupy the next N slots. */
export function fairPlayQueue(queue: Song[]): { queue: Song[]; added: number } {
    if (!queue.length) return { queue, added: 0 };
    const groups = new Map<string, Song[]>();
    for (const track of queue) {
        const requester = track.info.requester as { id?: string } | undefined;
        const key = requester?.id ?? 'unknown';
        const group = groups.get(key);
        if (group) group.push(track);
        else groups.set(key, [track]);
    }

    const lanes = [...groups.values()];
    const cursors = lanes.map((): number => 0);
    const fair: Song[] = [];
    let added = 0;
    while (added < queue.length) {
        for (let lane = 0; lane < lanes.length; lane++) {
            const next = lanes[lane][cursors[lane]++];
            if (!next) continue;
            fair.push(next);
            added++;
        }
    }
    return { queue: fair, added };
}

export function purgeAutoplayQueue(queue: Song[]): { queue: Song[]; removed: number } {
    const filtered = queue.filter(track => !track.autoplay);
    return { queue: filtered, removed: queue.length - filtered.length };
}

export function rememberSeedState(
    state: { seed: Song | null; seeds: Song[] },
    song: Song
): { seed: Song; seeds: Song[] } {
    const signature = trackSignature(song);
    return {
        seed: song,
        seeds: [
            song,
            ...state.seeds.filter(
                existing =>
                    trackSignature(existing) !== signature &&
                    trackKey(existing) !== trackKey(song)
            ),
        ].slice(0, AUTOPLAY_SEEDS),
    };
}

/** A playlist request contributes up to three random, distinct seed lanes.
 * Favor different artists first, then fill with other unique tracks. */
export function playlistSeeds(tracks: Song[], shuffle: <T>(items: T[]) => T[]): Song[] {
    const unique: Song[] = [];
    const seenTracks = new Set<string>();
    const seenArtists = new Set<string>();
    const leftovers: Song[] = [];
    for (const track of shuffle(tracks)) {
        const signature = trackSignature(track) || trackKey(track);
        const key = trackKey(track);
        if (!signature || seenTracks.has(`s:${signature}`)) continue;
        if (key && seenTracks.has(`k:${key}`)) continue;
        seenTracks.add(`s:${signature}`);
        if (key) seenTracks.add(`k:${key}`);
        const artist = normalizeAuthor(track.info?.author) || signature;
        if (!seenArtists.has(artist) && unique.length < AUTOPLAY_SEEDS) {
            seenArtists.add(artist);
            unique.push(track);
        } else {
            leftovers.push(track);
        }
    }
    for (const track of leftovers) {
        if (unique.length >= AUTOPLAY_SEEDS) break;
        unique.push(track);
    }
    return unique;
}
