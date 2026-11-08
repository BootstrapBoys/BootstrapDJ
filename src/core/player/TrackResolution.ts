import { LoadType, type Node, type Track } from 'shoukaku';
import type { User } from 'discord.js';

import type { Song } from '../Dispatcher.js';
import { trackKey, trackSignature } from './TrackIdentity.js';

const YOUTUBE_SEARCH = 'ytmsearch';

export interface ResolutionHost {
    node?: Node;
    buildTrack(track: Track, user: User): Song;
    user?: User | null;
}

export interface RecentState {
    current: Song | null;
    queue: Song[];
    history: Song[];
}

/** Resolve an identifier to a plain track list ([] on any failure). */
export async function resolveTracks(host: ResolutionHost, identifier: string): Promise<Track[]> {
    const resolve = await host.node?.rest.resolve(identifier).catch(() => null);
    return Array.isArray(resolve?.data) ? resolve.data : [];
}

/** YouTube id for a track. The lookup deliberately uses a YouTube prefix
 * rather than config.searchEngine: with a Deezer/Spotify engine configured,
 * searching it for a video id returns none, and autoplay pins to the seed. */
export async function youtubeIdFor(host: ResolutionHost, song: Song): Promise<string | null> {
    const looksLikeId = (value?: string): boolean => Boolean(value && /^[\w-]{11}$/.test(value));
    if (song.info.sourceName === 'youtube' && looksLikeId(song.info.identifier)) {
        return song.info.identifier;
    }
    const resolve = await host.node?.rest
        .resolve(`${YOUTUBE_SEARCH}:${song.info.title} ${song.info.author}`)
        .catch(() => null);
    const data = resolve?.data;
    if (!Array.isArray(data)) return null;
    const match = data.find(
        track => track.info?.sourceName === 'youtube' && looksLikeId(track.info?.identifier)
    );
    return match?.info?.identifier ?? null;
}

/** Re-resolve a saved track so its encoded payload matches this node. */
export async function resolveFresh(host: ResolutionHost, track: Song): Promise<Song | null> {
    const uri = track.info?.uri;
    const requester = track.info?.requester;
    if (!uri || !requester) return null;
    try {
        const res = await host.node?.rest.resolve(uri);
        if (!res) return null;
        if (res.loadType === LoadType.TRACK) return host.buildTrack(res.data, requester);
        if (res.loadType === LoadType.SEARCH && res.data.length)
            return host.buildTrack(res.data[0], requester);
    } catch {
        // A stale node or unavailable track is handled by the caller's retry.
    }
    return null;
}

export function isRecent(state: RecentState, track: Song): boolean {
    const key = trackKey(track);
    const signature = trackSignature(track);
    if (!key && !signature) return false;
    const matches = (candidate: Song): boolean =>
        (Boolean(key) && trackKey(candidate) === key) ||
        (Boolean(signature) && trackSignature(candidate) === signature);
    if (state.current && matches(state.current)) return true;
    if (state.queue.some(matches)) return true;
    return state.history.slice(-15).some(matches);
}
