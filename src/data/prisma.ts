import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { PrismaClient } from '../generated/prisma/client.js';

export function trackKey(track: unknown): string | null {
    const info = (track as { info?: { uri?: string; identifier?: string; sourceName?: string } })
        ?.info;
    if (!info) return null;
    if (info.uri) return info.uri;
    if (info.identifier && info.sourceName) return `${info.sourceName}:${info.identifier}`;
    return null;
}

export function createPrismaClient(
    url = process.env.DATABASE_URL || 'file:./prisma/bootstrapdj.db'
): PrismaClient {
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

async function backfillSongKeys(prisma: PrismaClient): Promise<void> {
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Song'`
    );
    if (!tables.length) return;
    const columns =
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info('Song')`);
    if (!columns.some(column => column.name === 'trackKey')) return;

    const rows = await prisma.song.findMany({
        where: { trackKey: null },
        select: { id: true, track: true },
    });
    const writes = [];
    for (const row of rows) {
        try {
            const parsed: unknown = JSON.parse(row.track);
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            const key = entries
                .map(trackKey)
                .find((candidate): candidate is string => candidate !== null);
            if (key)
                writes.push(prisma.song.update({ where: { id: row.id }, data: { trackKey: key } }));
        } catch {
            // Malformed legacy rows are ignored; removal falls back to raw text.
        }
    }
    for (let index = 0; index < writes.length; index += 100) {
        await prisma.$transaction(writes.slice(index, index + 100));
    }
}

export async function backfillSongPositions(prisma: PrismaClient): Promise<void> {
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Song'`
    );
    if (!tables.length) return;
    const columns =
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info('Song')`);
    if (!columns.some(column => column.name === 'position')) return;

    const playlists = await prisma.playlist.findMany({ select: { id: true } });
    for (const playlist of playlists) {
        const rows = await prisma.song.findMany({
            where: { playlistId: playlist.id },
            orderBy: { id: 'asc' },
            select: { id: true, position: true },
        });
        if (rows.every((row, index) => row.position === index)) continue;
        await prisma.$transaction(
            rows.map((row, index) =>
                prisma.song.update({ where: { id: row.id }, data: { position: index } })
            )
        );
    }
}

/** Enable WAL, bound lock waits, and normalize legacy playlist rows. */
export async function initializePrisma(prisma: PrismaClient): Promise<void> {
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 10000');
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
    await backfillSongKeys(prisma);
    await backfillSongPositions(prisma);
}
