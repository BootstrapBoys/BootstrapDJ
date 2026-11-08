import type { Track } from 'shoukaku';

import type { Song } from '../Dispatcher.js';

export function normalizeAuthor(value?: string): string {
    return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** URI is stable across re-searches; `encoded` is not. */
export function trackKey(track: Song | Track): string {
    const info = track?.info;
    if (info?.uri) return info.uri;
    if (info?.identifier && info?.sourceName) return `${info.sourceName}:${info.identifier}`;
    return track?.encoded ?? '';
}

/** Cross-source identity for the same recording. */
export function trackSignature(track: Song | Track): string {
    const info = track?.info;
    const title = (info?.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const author = normalizeAuthor(info?.author);
    return title && author ? `${title}|${author}` : '';
}
