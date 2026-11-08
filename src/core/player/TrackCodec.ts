import type { Song } from '../Dispatcher.js';

export interface SavedTrack {
    encoded: string;
    autoplay?: boolean;
    info: {
        identifier: string;
        isSeekable: boolean;
        author: string;
        length: number;
        isStream: boolean;
        title: string;
        uri?: string;
        artworkUrl?: string;
        isrc?: string;
        sourceName: string;
    };
}

/** Strip runtime-only state (requester, live player position) for storage. */
export function toSaved(song: Song): SavedTrack {
    // Optional fields are only set when present: undefined keys vanish through
    // JSON.stringify and the stored row would no longer match this shape.
    const info: SavedTrack['info'] = {
        identifier: song.info.identifier,
        isSeekable: song.info.isSeekable,
        author: song.info.author,
        length: song.info.length,
        isStream: song.info.isStream,
        title: song.info.title,
        sourceName: song.info.sourceName,
    };
    if (song.info.uri) info.uri = song.info.uri;
    if (song.info.artworkUrl) info.artworkUrl = song.info.artworkUrl;
    if (song.info.isrc) info.isrc = song.info.isrc;
    return { encoded: song.encoded, autoplay: song.autoplay, info };
}
