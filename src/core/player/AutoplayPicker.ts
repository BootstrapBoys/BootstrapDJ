import type { Track } from 'shoukaku';
import type { User } from 'discord.js';

import type { Song } from '../Dispatcher.js';
import { normalizeAuthor, trackKey, trackSignature } from './TrackIdentity.js';

/** Draw from the relevance-ordered head of a mix; its tail is loosely related. */
const AUTOPLAY_HEAD = 12;
const AUTOPLAY_SEED_WEIGHT = 3;
const AUTOPLAY_RELATED_WEIGHT = 2;
const AUTOPLAY_RELATED = 6;
const AUTOPLAY_SPREAD_CHANCE = 0.35;

export type AutoplayAffinity = {
    seedArtist: string;
    relatedArtists: string[];
};

/** How close a candidate is to what the user actually asked for. */
export function affinityWeight(track: Track, affinity: AutoplayAffinity): number {
    const author = normalizeAuthor(track.info?.author);
    if (!author) return 1;
    const seed = normalizeAuthor(affinity.seedArtist);
    if (seed && (author === seed || author.includes(seed) || seed.includes(author))) {
        return AUTOPLAY_SEED_WEIGHT;
    }
    const related = affinity.relatedArtists.some(name => {
        const normalized = normalizeAuthor(name);
        return normalized && (author === normalized || author.includes(normalized) || normalized.includes(author));
    });
    return related ? AUTOPLAY_RELATED_WEIGHT : 1;
}

export interface PickerState {
    history: Song[];
    botUser: User | null;
    isRecent(track: Song | Track): boolean;
    buildTrack(track: Track, user: User): Song;
}

/** Choose from candidates, skipping recent tracks and demoting the artists
 * heard in the last few tracks, so a thin mix still drifts instead of looping.
 * `affinity` biases the draw toward the requested artist and its neighbours. */
export function chooseFrom(
    tracks: Track[],
    affinity: AutoplayAffinity | undefined,
    state: PickerState
): Song | null {
    if (!state.botUser) return null;
    const usable = tracks.filter(track => track?.encoded && !state.isRecent(track));
    if (!usable.length) return null;
    const avoid = new Set(
        state.history
            .slice(-3)
            .map(track => track.info?.author)
            .filter((author): author is string => Boolean(author))
    );
    const varied = usable.filter(track => !avoid.has(track.info?.author));
    const pool = (varied.length ? varied : usable).slice(0, AUTOPLAY_HEAD);
    const draw = affinity
        ? pool.flatMap(track => Array(affinityWeight(track, affinity)).fill(track) as Track[])
        : pool;
    return state.buildTrack(draw[Math.floor(Math.random() * draw.length)], state.botUser);
}

/** Stable identity helpers kept alongside the picker for its callers. */
export { trackKey, trackSignature };

export interface SeedPickHost {
    relatedTracks(seed: Song): Promise<Track[]>;
    relatedArtistNames(seed: Song): Promise<string[]>;
    pickFromQuery(query: string): Promise<Song | null>;
    chooseFrom(tracks: Track[], affinity?: AutoplayAffinity): Song | null;
    shuffle<T>(items: T[]): T[];
}

/** Pick one track for a seed: weighted mix first, related lane occasionally,
 * then same-artist fallback. Never returns a failure for a thin mix. */
export async function pickForSeed(seed: Song, host: SeedPickHost): Promise<Song | null> {
    const mix = await host.relatedTracks(seed);
    const seedArtist = seed.info.author ?? '';
    const related = host.shuffle((await host.relatedArtistNames(seed)).slice(0, AUTOPLAY_RELATED));
    const seedOnlyMix =
        mix.length > 0 &&
        mix.every(track => {
            const author = normalizeAuthor(track.info?.author);
            const normalizedSeed = normalizeAuthor(seedArtist);
            return !author || author === normalizedSeed || author.includes(normalizedSeed) || normalizedSeed.includes(author);
        });

    if (seedOnlyMix && related.length && Math.random() < AUTOPLAY_SPREAD_CHANCE) {
        const spreadPick = await host.pickFromQuery(related[0]);
        if (spreadPick) return spreadPick;
    }
    if (mix.length) {
        const fromMix = host.chooseFrom(mix, { seedArtist, relatedArtists: related });
        if (fromMix) return fromMix;
    }
    for (const name of related) {
        const pick = await host.pickFromQuery(name);
        if (pick) return pick;
    }
    return await host.pickFromQuery(seed.info.author);
}
