import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../dist/generated/prisma/client.js';

import ServerData from '../dist/data/server.js';
import { initializePrisma } from '../dist/data/prisma.js';

// Never touch prisma/bootstrapdj.db (live data): a throwaway file is
// given the two tables these tests exercise.
const dbPath = path.join(os.tmpdir(), `bootstrapdj-test-${process.pid}-${Date.now()}.db`);
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }) });
const db = new ServerData(prisma);
const user = 'test-user';

const track = (title, uri, encoded = `${title}-enc`) => ({
    encoded,
    info: { identifier: title, author: 'A', title, uri, sourceName: 'deezer' },
});

before(async () => {
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "Playlist" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "name" TEXT NOT NULL)`
    );
    await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "Playlist_userId_name_key" ON "Playlist"("userId", "name")`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "Song" ("id" TEXT NOT NULL PRIMARY KEY, "track" TEXT NOT NULL, "playlistId" TEXT NOT NULL, "trackKey" TEXT, "position" INTEGER NOT NULL DEFAULT 0)`
    );
    await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "Song_track_playlistId_key" ON "Song"("track", "playlistId")`
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX "Song_playlistId_idx" ON "Song"("playlistId")`);
    await prisma.$executeRawUnsafe(
        `CREATE INDEX "Song_playlistId_trackKey_idx" ON "Song"("playlistId", "trackKey")`
    );
});

after(async () => {
    await prisma.$disconnect();
    fs.rmSync(dbPath, { force: true });
});

test('addSong stores one row per track and rejects the same track twice', async () => {
    await db.createPlaylist(user, 'ParkerJack');

    // Same song re-searched: LavaSrc hands back a different `encoded`.
    const first = await db.addSong(
        user,
        'ParkerJack',
        track('Hurt', 'https://deezer.com/track/1', 'TOKEN-A')
    );
    const duplicate = await db.addSong(
        user,
        'ParkerJack',
        track('Hurt', 'https://deezer.com/track/1', 'TOKEN-B')
    );

    assert.equal(first, true);
    assert.equal(duplicate, false);
    const songs = await db.getSong(user, 'ParkerJack');
    assert.equal(songs.length, 1);
    assert.equal(songs[0].trackKey, 'https://deezer.com/track/1');
});

test('a different track is added alongside it', async () => {
    const added = await db.addSong(
        user,
        'ParkerJack',
        track('Other', 'https://deezer.com/track/2')
    );

    assert.equal(added, true);
    assert.equal((await db.getSong(user, 'ParkerJack')).length, 2);
});

test('getPlaylists reports song counts for the autocomplete', async () => {
    const playlists = await db.getPlaylists(user);

    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].name, 'ParkerJack');
    assert.equal(playlists[0]._count.songs, 2);
});

test('deletePlaylist removes the playlist and its songs', async () => {
    const deleted = await db.deletePlaylist(user, 'ParkerJack');

    assert.equal(deleted, true);
    assert.equal(await db.getPLaylist(user, 'ParkerJack'), null);
    assert.equal((await db.getSong(user, 'ParkerJack')).length, 0);
});

test('deleting a playlist that does not exist returns false', async () => {
    assert.equal(await db.deletePlaylist(user, 'ParkerJack'), false);
});

test('playlist names keep their internal spaces', async () => {
    await db.createPlaylist(user, 'My Mix');
    await db.addSong(user, 'My Mix', track('Song', 'https://deezer.com/track/3'));

    const found = await db.getPLaylist(user, 'My Mix');

    assert.equal(found?.name, 'My Mix');
});

test('startup backfill keys legacy playlist rows', async () => {
    await db.createPlaylist(user, 'Legacy Backfill');
    const playlist = await db.getPLaylist(user, 'Legacy Backfill');
    assert.ok(playlist);
    await prisma.song.create({
        data: {
            track: JSON.stringify(track('Old', 'https://deezer.com/track/20', 'OLD')),
            playlistId: playlist.id,
        },
    });
    await db.initialize();
    const row = await prisma.song.findFirst({ where: { playlistId: playlist.id } });
    assert.equal(row?.trackKey, 'https://deezer.com/track/20');
});

test('addSong upgrades a null-key legacy duplicate instead of inserting', async () => {
    await db.createPlaylist(user, 'Legacy Duplicate');
    const playlist = await db.getPLaylist(user, 'Legacy Duplicate');
    assert.ok(playlist);
    await prisma.song.create({
        data: {
            track: JSON.stringify(track('Legacy', 'https://deezer.com/track/21', 'LEGACY-A')),
            playlistId: playlist.id,
        },
    });
    const added = await db.addSong(
        user,
        'Legacy Duplicate',
        track('Legacy', 'https://deezer.com/track/21', 'LEGACY-B')
    );
    assert.equal(added, false);
    const rows = await prisma.song.findMany({ where: { playlistId: playlist.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].trackKey, 'https://deezer.com/track/21');
});

test('removeSong finds the stored row by canonical track key', async () => {
    await db.createPlaylist(user, 'Canonical');
    await db.addSong(user, 'Canonical', track('Keep', 'https://deezer.com/track/10', 'KEEP'));
    await db.addSong(user, 'Canonical', track('Drop', 'https://deezer.com/track/11', 'DROP'));

    assert.equal(await db.removeSong(user, 'Canonical', 'https://deezer.com/track/11'), true);
    assert.equal((await db.getSong(user, 'Canonical')).length, 1);
    assert.equal(await db.removeSong(user, 'Canonical', 'https://deezer.com/track/11'), false);
});

test('playlist rows keep insertion order and remove by visible index', async () => {
    await db.createPlaylist(user, 'Ordered');
    await db.addSong(user, 'Ordered', track('First', 'https://deezer.com/track/31'));
    await db.addSong(user, 'Ordered', track('Second', 'https://deezer.com/track/32'));
    await db.addSong(user, 'Ordered', track('Third', 'https://deezer.com/track/33'));

    const songs = await db.getSong(user, 'Ordered');
    assert.deepEqual(
        songs.map(row => row.position),
        [0, 1, 2]
    );
    assert.deepEqual(
        songs.map(row => row.trackKey),
        [
            'https://deezer.com/track/31',
            'https://deezer.com/track/32',
            'https://deezer.com/track/33',
        ]
    );

    assert.equal(await db.removeSongAt(user, 'Ordered', 2), true);
    const remaining = await db.getSong(user, 'Ordered');
    assert.deepEqual(
        remaining.map(row => row.trackKey),
        ['https://deezer.com/track/31', 'https://deezer.com/track/33']
    );
});

test('startup backfill gives legacy rows stable positions and is idempotent', async () => {
    await db.createPlaylist(user, 'Position Backfill');
    const playlist = await db.getPLaylist(user, 'Position Backfill');
    assert.ok(playlist);

    for (const id of ['song-z', 'song-a', 'song-m']) {
        await prisma.song.create({
            data: {
                id,
                track: JSON.stringify(track(id, `https://deezer.com/track/${id}`)),
                playlistId: playlist.id,
                position: 0,
            },
        });
    }

    await initializePrisma(prisma);
    const first = await db.getSong(user, 'Position Backfill');
    assert.deepEqual(
        first.map(row => row.id),
        ['song-a', 'song-m', 'song-z']
    );
    assert.deepEqual(
        first.map(row => row.position),
        [0, 1, 2]
    );

    await initializePrisma(prisma);
    const second = await db.getSong(user, 'Position Backfill');
    assert.deepEqual(
        second.map(row => row.id),
        ['song-a', 'song-m', 'song-z']
    );
});
