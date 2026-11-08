import type { Song } from '../Dispatcher.js';

const DEEZER_API = 'https://api.deezer.com';
const AUTOPLAY_CACHE_LIMIT = 100;

type DeezerTrackRef = { id?: number; artist?: { id?: number } };
type DeezerList = { data?: Array<{ id?: number; name?: string }> };

export type DeezerChartTrack = {
    link?: string;
    title?: string;
    artist?: { name?: string };
    explicit_lyrics?: boolean;
    explicit_content_lyrics?: number;
};

const relatedArtistCache = new Map<string, string[]>();
let chartCache: { at: number; tracks: DeezerChartTrack[] } | null = null;
const AUTOPLAY_CHART_URL = 'https://api.deezer.com/chart/0/tracks?limit=50';
const AUTOPLAY_CHART_TTL_MS = 30 * 60_000;

/** Deezer's public API handles autoplay discovery; no user credentials needed. */
export class DeezerClient {
    private async fetchJson<T>(url: string): Promise<T | null> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(url, { signal: controller.signal });
            return response.ok ? ((await response.json()) as T) : null;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Deezer track id for any seed: direct, by ISRC, or by artist+title. */
    public async trackId(song: Song): Promise<string | null> {
        if (song.info.sourceName === 'deezer' && /^\d+$/.test(song.info.identifier)) {
            return song.info.identifier;
        }
        if (song.info.isrc) {
            const byIsrc = await this.fetchJson<DeezerTrackRef>(
                `${DEEZER_API}/track/isrc:${song.info.isrc}`
            );
            if (byIsrc?.id) return String(byIsrc.id);
        }
        const query = encodeURIComponent(`artist:"${song.info.author}" track:"${song.info.title}"`);
        const found = await this.fetchJson<DeezerList>(`${DEEZER_API}/search?q=${query}&limit=1`);
        const id = found?.data?.[0]?.id;
        return id ? String(id) : null;
    }

    /** Artists Deezer considers similar to the seed's artist. */
    public async relatedArtists(song: Song): Promise<string[]> {
        const cacheKey = song.info.author?.toLowerCase() ?? '';
        const cached = relatedArtistCache.get(cacheKey);
        if (cached) return cached;

        const trackId = await this.trackId(song);
        if (!trackId) return [];
        const track = await this.fetchJson<DeezerTrackRef>(`${DEEZER_API}/track/${trackId}`);
        const artistId = track?.artist?.id;
        if (!artistId) return [];
        const related = await this.fetchJson<DeezerList>(
            `${DEEZER_API}/artist/${artistId}/related?limit=10`
        );
        const names = (related?.data ?? [])
            .map(artist => artist?.name)
            .filter((name): name is string => Boolean(name));
        if (related && cacheKey) {
            if (relatedArtistCache.size >= AUTOPLAY_CACHE_LIMIT) {
                const oldest = relatedArtistCache.keys().next().value;
                if (oldest) relatedArtistCache.delete(oldest);
            }
            relatedArtistCache.set(cacheKey, names);
        }
        return names;
    }

    /** Cold-start chart tracks, filtered to non-explicit entries and cached. */
    public async chart(): Promise<DeezerChartTrack[]> {
        if (chartCache && Date.now() - chartCache.at < AUTOPLAY_CHART_TTL_MS) {
            return chartCache.tracks;
        }
        const response = await this.fetchJson<{ data?: DeezerChartTrack[] }>(AUTOPLAY_CHART_URL);
        const tracks = response?.data?.filter(track => track.link) ?? [];
        const clean = tracks.filter(
            track => !track.explicit_lyrics && !track.explicit_content_lyrics
        );
        if (!clean.length) return [];
        chartCache = { at: Date.now(), tracks: clean };
        return clean;
    }
}
