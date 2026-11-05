import { Song } from '../structures/Dispatcher.js';

export type SortField = 'title' | 'author' | 'duration' | 'requester';
export type SortDirection = 'asc' | 'desc';

/** Stable identity used by queue tools; mirrors the dispatcher's dedupe rules. */
export function trackIdentity(track: Song): string {
    const info = track?.info;
    if (info?.uri) return info.uri;
    if (info?.identifier && info?.sourceName) return `${info.sourceName}:${info.identifier}`;
    return track?.encoded ?? JSON.stringify(info?.title ?? '') + (info?.author ?? '');
}

export function requesterId(track: Song): string {
    const requester = track.info?.requester as { id?: string } | undefined;
    return requester?.id ?? 'unknown';
}

function fieldValue(track: Song, field: SortField): string | number {
    switch (field) {
        case 'title':
            return track.info?.title ?? '';
        case 'author':
            return track.info?.author ?? '';
        case 'duration':
            return track.info?.length ?? 0;
        case 'requester':
            return requesterId(track);
    }
}

/** Stable sort; current order is preserved for equal keys. */
export function sortQueue(queue: Song[], field: SortField, direction: SortDirection): Song[] {
    const sign = direction === 'asc' ? 1 : -1;
    return queue
        .map((track, index) => ({ track, index }))
        .sort((left, right) => {
            const a = fieldValue(left.track, field);
            const b = fieldValue(right.track, field);
            const result =
                typeof a === 'number' && typeof b === 'number'
                    ? a - b
                    : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
            return result === 0 ? left.index - right.index : result * sign;
        })
        .map(entry => entry.track);
}

export function dedupeQueue(queue: Song[]): Song[] {
    const seen = new Set<string>();
    return queue.filter(track => {
        const key = trackIdentity(track);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Accepts 30s, 01:30, 1h 2m 3s, or plain seconds. */
export function parseTime(input: string): number | null {
    const value = input.trim().toLowerCase();
    if (!value) return null;
    if (/^\d+(?:\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) {
        const parts = value.split(':').map(Number);
        const seconds = parts.reduce((total, part) => total * 60 + part, 0);
        return seconds * 1000;
    }
    const matches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)];
    if (!matches.length) return null;
    let ms = 0;
    for (const match of matches) {
        const amount = Number(match[1]);
        if (match[2] === 'h') ms += amount * 3_600_000;
        if (match[2] === 'm') ms += amount * 60_000;
        if (match[2] === 's') ms += amount * 1000;
    }
    return Math.round(ms);
}

export function removeRange(queue: Song[], from: number, to: number): Song[] {
    const start = Math.max(0, from - 1);
    const end = Math.min(queue.length, to);
    if (start >= end) return [];
    return queue.splice(start, end - start);
}

export function requesterFilter(queue: Song[], userId: string): Song[] {
    return queue.filter(track => requesterId(track) === userId);
}
