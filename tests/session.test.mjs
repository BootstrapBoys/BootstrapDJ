import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

import ServerData from '../dist/database/server.js';
import { fromSaved, toSaved } from '../dist/structures/Dispatcher.js';
import { isRestorable } from '../dist/utils/Session.js';
import { fakeUser, makeSong } from './helpers.mjs';

const dbPath = path.join(os.tmpdir(), `bootstrapdj-session-${process.pid}-${Date.now()}.db`);
const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
const db = new ServerData(prisma);

before(async () => {
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "Session" (
            "guildId" TEXT NOT NULL PRIMARY KEY,
            "textId" TEXT NOT NULL,
            "voiceId" TEXT NOT NULL,
            "current" TEXT,
            "queue" TEXT NOT NULL,
            "loop" TEXT NOT NULL DEFAULT 'off',
            "autoplay" BOOLEAN NOT NULL DEFAULT false,
            "volume" INTEGER NOT NULL DEFAULT 100,
            "paused" BOOLEAN NOT NULL DEFAULT false,
            "updatedAt" DATETIME NOT NULL
        )`
    );
});

after(async () => {
    await prisma.$disconnect();
    fs.rmSync(dbPath, { force: true });
});

test('toSaved drops the requester and serialises cleanly', () => {
    const song = makeSong('Hurt', { uri: 'https://x/1', author: 'NIN', encoded: 'ENC' });

    const saved = toSaved(song);

    assert.equal(saved.encoded, 'ENC');
    assert.equal(saved.info.uri, 'https://x/1');
    assert.equal(saved.info.title, 'Hurt');
    assert.equal(saved.info.requester, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved);
});

test('fromSaved rebuilds a playable Song with the bot as requester', () => {
    const song = makeSong('Hurt', { uri: 'https://x/1', encoded: 'ENC', autoplay: true });

    const rebuilt = fromSaved(JSON.parse(JSON.stringify(toSaved(song))), fakeUser);

    assert.equal(rebuilt.encoded, 'ENC');
    assert.equal(rebuilt.info.title, 'Hurt');
    assert.equal(rebuilt.info.uri, 'https://x/1');
    assert.equal(rebuilt.autoplay, true);
    assert.equal(rebuilt.info.requester.id, fakeUser.id);
});

test('isRestorable honours the age limit and the disable switch', () => {
    const now = Date.now();

    assert.equal(isRestorable(new Date(now - 1000), 60, now), true);
    assert.equal(isRestorable(new Date(now - 120_000), 60, now), false);
    assert.equal(isRestorable(new Date(now), 0, now), false);
});

test('saveSession upserts one row per guild', async () => {
    const base = {
        guildId: 'g1',
        textId: 't1',
        voiceId: 'v1',
        current: JSON.stringify({ encoded: 'a', info: {} }),
        queue: '[]',
        loop: 'off',
        autoplay: false,
        volume: 100,
        paused: false,
    };

    await db.saveSession(base);
    await db.saveSession({ ...base, volume: 55, paused: true, loop: 'queue', autoplay: true });

    const rows = await db.getSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].volume, 55);
    assert.equal(rows[0].paused, true);
    assert.equal(rows[0].loop, 'queue');
    assert.equal(rows[0].autoplay, true);
});

test('deleteSession removes the row and tolerates a missing one', async () => {
    await db.deleteSession('g1');
    assert.equal((await db.getSessions()).length, 0);

    await db.deleteSession('g1');
});
