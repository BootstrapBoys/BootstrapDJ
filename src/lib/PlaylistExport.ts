/** Versioned, portable representation of one saved playlist. */
export type PlaylistExportDocument = {
    format: 'bootstrapdj-playlist';
    version: 1;
    exportedAt: string;
    playlist: {
        name: string;
        trackCount: number;
        skipped: number;
        tracks: unknown[];
    };
};

export type PlaylistExport = {
    text: string;
    count: number;
    skipped: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrack(value: unknown): boolean {
    return isRecord(value) && isRecord(value.info) && typeof value.info.title === 'string';
}

/** A stored row may be one track or a legacy array of tracks. */
function storedEntries(track: string): unknown[] | null {
    try {
        const parsed: unknown = JSON.parse(track);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return null;
    }
}

/**
 * Serialize playlist rows without touching their track payloads: `encoded`
 * stays intact so a future file import can enqueue the exact saved tracks.
 * Malformed or legacy non-track entries are counted and omitted.
 */
export function buildPlaylistExport(
    name: string,
    rows: readonly { track: string }[],
    exportedAt: Date = new Date()
): PlaylistExport {
    const tracks: unknown[] = [];
    let skipped = 0;

    for (const row of rows) {
        const entries = storedEntries(row.track);
        if (!entries) {
            skipped += 1;
            continue;
        }
        for (const entry of entries) {
            if (isTrack(entry)) tracks.push(entry);
            else skipped += 1;
        }
    }

    const document: PlaylistExportDocument = {
        format: 'bootstrapdj-playlist',
        version: 1,
        exportedAt: exportedAt.toISOString(),
        playlist: {
            name,
            trackCount: tracks.length,
            skipped,
            tracks,
        },
    };

    return {
        text: JSON.stringify(document, null, 2),
        count: tracks.length,
        skipped,
    };
}

/** A filesystem/attachment-safe name; Discord accepts spaces. */
export function playlistExportFilename(name: string): string {
    const base = Array.from(name)
        .map(char => {
            const code = char.codePointAt(0) ?? 0;
            return code < 32 || /[\\/:*?"<>|]/.test(char) ? '_' : char;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    return `${base || 'playlist'}.json`;
}
