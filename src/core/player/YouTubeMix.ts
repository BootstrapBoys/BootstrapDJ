import { LoadType, type Node, type Track } from 'shoukaku';

import { incrementCounter } from '../../lib/PerformanceCounters.js';
import type { Song } from '../Dispatcher.js';
import { trackKey } from './TrackIdentity.js';

type MixCacheEntry = { at: number; tracks: Track[] };
const relatedTracksCache = new Map<string, MixCacheEntry>();
const relatedTracksInFlight = new Map<string, Promise<Track[]>>();
const relatedTracksNegative = new Map<string, number>();
const AUTOPLAY_CACHE_LIMIT = 100;
const AUTOPLAY_MIX_TTL_MS = 10 * 60_000;
const AUTOPLAY_NEGATIVE_TTL_MS = 60_000;

export interface MixHost {
    youtubeIdFor(song: Song): Promise<string | null>;
    node?: Node;
}

function rememberNegative(key: string): void {
    if (relatedTracksNegative.size >= AUTOPLAY_CACHE_LIMIT) {
        const oldest = relatedTracksNegative.keys().next().value;
        if (oldest) relatedTracksNegative.delete(oldest);
    }
    relatedTracksNegative.set(key, Date.now());
}

async function loadRelatedTracks(seed: Song, host: MixHost, key: string): Promise<Track[]> {
    const id = await host.youtubeIdFor(seed);
    if (!id) {
        if (key) rememberNegative(key);
        return [];
    }
    incrementCounter('autoplaySearches');
    const resolve = await host.node?.rest
        .resolve(`https://www.youtube.com/watch?v=${id}&list=RD${id}`)
        .catch(() => null);
    if (!resolve || resolve.loadType !== LoadType.PLAYLIST) {
        if (key) rememberNegative(key);
        return [];
    }
    const playlist = resolve.data as { tracks?: Track[] };
    const tracks = playlist.tracks ?? [];
    if (!tracks.length) {
        if (key) rememberNegative(key);
        return tracks;
    }
    if (key) {
        relatedTracksNegative.delete(key);
        if (relatedTracksCache.size >= AUTOPLAY_CACHE_LIMIT) {
            const oldest = relatedTracksCache.keys().next().value;
            if (oldest) relatedTracksCache.delete(oldest);
        }
        relatedTracksCache.set(key, { at: Date.now(), tracks });
    }
    return tracks;
}

/** YouTube's mix for a seed track — the only source here that spans artists;
 * an artist search returns the same name over and over. */
export async function relatedTracks(seed: Song, host: MixHost): Promise<Track[]> {
    const key = trackKey(seed);
    const now = Date.now();
    const negativeAt = key ? relatedTracksNegative.get(key) : undefined;
    if (negativeAt !== undefined && now - negativeAt < AUTOPLAY_NEGATIVE_TTL_MS) {
        incrementCounter('autoplayCacheHits');
        return [];
    }

    const cached = key ? relatedTracksCache.get(key) : undefined;
    if (cached && now - cached.at < AUTOPLAY_MIX_TTL_MS) {
        incrementCounter('autoplayCacheHits');
        return cached.tracks;
    }

    if (key) {
        const inFlight = relatedTracksInFlight.get(key);
        if (inFlight) {
            incrementCounter('autoplayCoalesced');
            return await inFlight;
        }
        incrementCounter('autoplayCacheMisses');
        const request = loadRelatedTracks(seed, host, key);
        relatedTracksInFlight.set(key, request);
        try {
            return await request;
        } finally {
            relatedTracksInFlight.delete(key);
        }
    }

    return await loadRelatedTracks(seed, host, '');
}
