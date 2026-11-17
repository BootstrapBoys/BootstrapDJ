import type { Song } from '../Dispatcher.js';

export interface SavedRequester {
    id: string;
    tag?: string;
    username?: string;
    avatar?: string;
}

export interface SavedTrack {
    encoded: string;
    autoplay?: boolean;
    /** Who asked for the track; absent in rows written before this field existed. */
    requester?: SavedRequester;
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

/**
 * Strip runtime-only state (live player position) for storage. The requester
 * is kept as plain fields so a restored session can attribute the track to the
 * person who asked for it instead of falling back to the bot.
 */
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
    const saved: SavedTrack = { encoded: song.encoded, autoplay: song.autoplay, info };
    const requester = song.info.requester;
    if (requester?.id) {
        const avatar =
            typeof requester.avatarURL === 'function' ? (requester.avatarURL() ?? null) : null;
        saved.requester = {
            id: requester.id,
            ...(requester.tag ? { tag: requester.tag } : {}),
            ...(requester.username ? { username: requester.username } : {}),
            ...(avatar ? { avatar } : {}),
        };
    }
    return saved;
}
