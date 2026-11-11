import { LoadType, type Node, type Track } from 'shoukaku';

import { incrementCounter } from '../../lib/PerformanceCounters.js';
import type { Song } from '../Dispatcher.js';
import { trackKey } from './TrackIdentity.js';

type MixCacheEntry = { at: number; tracks: Track[] };
const relatedTracksCache = new Map<string, MixCacheEntry>();
const AUTOPLAY_CACHE_LIMIT = 100;
const AUTOPLAY_MIX_TTL_MS = 10 * 60_000;

export interface MixHost {
    youtubeIdFor(song: Song): Promise<string | null>;
    node?: Node;
}

/** YouTube's mix for a seed track — the only source here that spans artists;
 * an artist search returns the same name over and over. */
export async function relatedTracks(seed: Song, host: MixHost): Promise<Track[]> {
    const key = trackKey(seed);
    const cached = key ? relatedTracksCache.get(key) : undefined;
    if (cached && Date.now() - cached.at < AUTOPLAY_MIX_TTL_MS) {
        incrementCounter('autoplayCacheHits');
        return cached.tracks;
    }
    if (key) incrementCounter('autoplayCacheMisses');

    const id = await host.youtubeIdFor(seed);
    if (!id) return [];
    incrementCounter('autoplaySearches');
    const resolve = await host.node?.rest
        .resolve(`https://www.youtube.com/watch?v=${id}&list=RD${id}`)
        .catch(() => null);
    if (!resolve || resolve.loadType !== LoadType.PLAYLIST) return [];
    const playlist = resolve.data as { tracks?: Track[] };
    const tracks = playlist.tracks ?? [];
    if (key && tracks.length) {
        if (relatedTracksCache.size >= AUTOPLAY_CACHE_LIMIT) {
            const oldest = relatedTracksCache.keys().next().value;
            if (oldest) relatedTracksCache.delete(oldest);
        }
        relatedTracksCache.set(key, { at: Date.now(), tracks });
    }
    return tracks;
}
