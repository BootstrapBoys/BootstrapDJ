import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

import ServerData from '../dist/database/server.js';

// Never touch prisma/lavamusic.db (it is tracked in git): a throwaway file is
// given the two tables these tests exercise.
const dbPath = path.join(os.tmpdir(), `bootstrapdj-test-${process.pid}-${Date.now()}.db`);
const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
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
        `CREATE TABLE "Song" ("id" TEXT NOT NULL PRIMARY KEY, "track" TEXT NOT NULL, "playlistId" TEXT NOT NULL)`
    );
    await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "Song_track_playlistId_key" ON "Song"("track", "playlistId")`
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX "Song_playlistId_idx" ON "Song"("playlistId")`);
});

after(async () => {
    await prisma.$disconnect();
    fs.rmSync(dbPath, { force: true });
});

test('addSong stores one row per track and rejects the same track twice', async () => {
    await db.createPlaylist(user, 'ParkerJack');

    // Same song re-searched: LavaSrc hands back a different `encoded`.
    const first = await db.addSong(user, 'ParkerJack', track('Hurt', 'https://deezer.com/track/1', 'TOKEN-A'));
    const duplicate = await db.addSong(
        user,
        'ParkerJack',
        track('Hurt', 'https://deezer.com/track/1', 'TOKEN-B')
    );

    assert.equal(first, true);
    assert.equal(duplicate, false);
    assert.equal((await db.getSong(user, 'ParkerJack')).length, 1);
});

test('a different track is added alongside it', async () => {
    const added = await db.addSong(user, 'ParkerJack', track('Other', 'https://deezer.com/track/2'));

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
