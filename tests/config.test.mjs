import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import ServerData from '../dist/database/server.js';

const dir = await mkdtemp(path.join(tmpdir(), 'bootstrapdj-config-'));
const dbPath = path.join(dir, 'config.db');
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }) });
const db = new ServerData(prisma);

test.before(async () => {
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "GuildSetting" ("guildId" TEXT NOT NULL, "key" TEXT NOT NULL, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL, PRIMARY KEY ("guildId", "key"))`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "PermissionRule" ("id" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "command" TEXT NOT NULL, "targetId" TEXT NOT NULL, "targetType" TEXT NOT NULL, "allow" BOOLEAN NOT NULL DEFAULT false)`
    );
    await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "PermissionRule_identity" ON "PermissionRule"("guildId", "command", "targetId", "targetType")`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "CommandAlias" ("id" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "scope" TEXT NOT NULL, "userId" TEXT NOT NULL DEFAULT '', "alias" TEXT NOT NULL, "command" TEXT NOT NULL)`
    );
    await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "CommandAlias_identity" ON "CommandAlias"("guildId", "scope", "userId", "alias")`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "CommandMapping" ("id" TEXT NOT NULL PRIMARY KEY, "guildId" TEXT NOT NULL, "scope" TEXT NOT NULL, "userId" TEXT NOT NULL DEFAULT '', "trigger" TEXT NOT NULL, "expansion" TEXT NOT NULL)`
    );
    await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "CommandMapping_identity" ON "CommandMapping"("guildId", "scope", "userId", "trigger")`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "UserPrefix" ("guildId" TEXT NOT NULL, "userId" TEXT NOT NULL, "prefix" TEXT NOT NULL, PRIMARY KEY ("guildId", "userId"))`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "Profile" ("userId" TEXT NOT NULL PRIMARY KEY, "color" TEXT, "bio" TEXT, "background" TEXT, "avatarShape" TEXT, "avatarBorder" TEXT, "privacy" TEXT NOT NULL DEFAULT 'public', "visible" BOOLEAN NOT NULL DEFAULT true, "serverVisible" BOOLEAN NOT NULL DEFAULT true, "updatedAt" DATETIME NOT NULL)`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "GameScore" ("guildId" TEXT NOT NULL, "userId" TEXT NOT NULL, "wins" INTEGER NOT NULL DEFAULT 0, "plays" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("guildId", "userId"))`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "CollectionShare" ("code" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL, "name" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "StatsDaily" ("guildId" TEXT NOT NULL, "day" TEXT NOT NULL, "seconds" INTEGER NOT NULL DEFAULT 0, "sessions" INTEGER NOT NULL DEFAULT 0, "gameSessions" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("guildId", "day"))`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "StatsTrack" ("guildId" TEXT NOT NULL, "trackId" TEXT NOT NULL, "title" TEXT NOT NULL, "author" TEXT NOT NULL, "source" TEXT NOT NULL, "uri" TEXT, "seconds" INTEGER NOT NULL DEFAULT 0, "plays" INTEGER NOT NULL DEFAULT 0, "lastPlayed" DATETIME NOT NULL, PRIMARY KEY ("guildId", "trackId"))`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "StatsListener" ("guildId" TEXT NOT NULL, "userId" TEXT NOT NULL, "seconds" INTEGER NOT NULL DEFAULT 0, "deafSeconds" INTEGER NOT NULL DEFAULT 0, "lastSeen" DATETIME NOT NULL, PRIMARY KEY ("guildId", "userId"))`
    );
    await prisma.$executeRawUnsafe(
        `CREATE TABLE "SessionLease" ("guildId" TEXT NOT NULL PRIMARY KEY, "botId" TEXT NOT NULL, "botName" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL)`
    );
});

test.after(async () => {
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
});

test('guild settings round-trip and reset', async () => {
    await db.setGuildSetting('g1', 'defaultvolume', '80');
    await db.setGuildSetting('g1', 'defaultautoplay', 'true');
    assert.equal(await db.getGuildSetting('g1', 'defaultvolume'), '80');
    assert.deepEqual(await db.getGuildSettings('g1'), {
        defaultautoplay: 'true',
        defaultvolume: '80',
    });
    assert.equal(await db.resetGuildSettings('g1'), 2);
    assert.equal(await db.getGuildSetting('g1', 'defaultvolume'), null);
});

test('permission rules deny and allow by user or role', async () => {
    assert.equal(await db.isCommandAllowed('g1', 'play', 'u1', []), true);
    await db.setPermissionRule('g1', 'play', 'u1', 'user', false);
    assert.equal(await db.isCommandAllowed('g1', 'play', 'u1', []), false);
    assert.equal(await db.isCommandAllowed('g1', 'play', 'u2', []), true);
    await db.setPermissionRule('g1', 'play', 'r1', 'role', true);
    assert.equal(await db.isCommandAllowed('g1', 'play', 'u1', ['r1']), true);
    assert.equal(await db.clearPermissionRules('g1', 'play'), 2);
});

test('server aliases take precedence over user aliases', async () => {
    await db.setCommandAlias('g1', 'user', 'u1', 'b', 'play');
    assert.equal((await db.getCommandAlias('g1', 'b', 'u1'))?.command, 'play');
    await db.setCommandAlias('g1', 'server', '', 'b', 'playnext');
    assert.equal((await db.getCommandAlias('g1', 'b', 'u1'))?.command, 'playnext');
    assert.equal((await db.listCommandAliases('g1', 'u1')).length, 2);
    assert.equal(await db.deleteCommandAlias('g1', 'server', '', 'b'), true);
    assert.equal((await db.getCommandAlias('g1', 'b', 'u1'))?.command, 'play');
});


test('command mappings resolve server before user scope', async () => {
    await db.setCommandMapping('g1', 'user', 'u1', 'r', 'play one');
    assert.equal((await db.getCommandMapping('g1', 'r', 'u1'))?.expansion, 'play one');
    await db.setCommandMapping('g1', 'server', '', 'r', 'play two');
    assert.equal((await db.getCommandMapping('g1', 'r', 'u1'))?.expansion, 'play two');
    assert.equal(await db.deleteCommandMapping('g1', 'server', '', 'r'), true);
    assert.equal((await db.getCommandMapping('g1', 'r', 'u1'))?.expansion, 'play one');
});


test('user prefixes round-trip and reset', async () => {
    await db.setUserPrefix('g1', 'u1', '?');
    assert.equal(await db.getUserPrefix('g1', 'u1'), '?');
    assert.equal(await db.resetUserPrefix('g1', 'u1'), true);
    assert.equal(await db.getUserPrefix('g1', 'u1'), null);
});

test('profiles store customization and privacy', async () => {
    const profile = await db.setProfile('u1', { color: '#ff8800', bio: 'Music first', privacy: 'private', visible: false });
    assert.equal(profile.color, '#ff8800');
    assert.equal(profile.privacy, 'private');
    assert.equal((await db.getProfile('u1'))?.bio, 'Music first');
});


test('game scores increment and rank by wins', async () => {
    await db.incrementGameScore('g1', 'u1', true);
    await db.incrementGameScore('g1', 'u1', false);
    await db.incrementGameScore('g1', 'u2', true);
    const board = await db.getGameLeaderboard('g1');
    assert.equal(board[0].userId, 'u2');
    assert.equal(board[0].wins, 1);
    assert.equal(board[0].plays, 1);
});


test('SQLite initialization enables WAL', async () => {
    await db.initialize();
    const rows = await prisma.$queryRawUnsafe('PRAGMA journal_mode');
    assert.equal(String(rows[0].journal_mode).toLowerCase(), 'wal');
});

test('stats retention keeps recent rows and each guild top 100', async () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const old = new Date('2025-01-01T00:00:00Z');
    const recent = new Date('2026-05-30T00:00:00Z');
    await prisma.statsDaily.create({ data: { guildId: 'g1', day: '2025-01-01', seconds: 10 } });
    await prisma.statsDaily.create({ data: { guildId: 'g1', day: '2026-05-30', seconds: 20 } });
    await prisma.statsTrack.create({ data: { guildId: 'g1', trackId: 'top', title: 'Top', author: 'A', source: 'deezer', seconds: 1000, plays: 1, lastPlayed: old } });
    await prisma.statsTrack.create({ data: { guildId: 'g1', trackId: 'tail', title: 'Tail', author: 'A', source: 'deezer', seconds: 1, plays: 1, lastPlayed: old } });
    await prisma.statsTrack.create({ data: { guildId: 'g1', trackId: 'new', title: 'New', author: 'A', source: 'deezer', seconds: 5, plays: 1, lastPlayed: recent } });
    // 100 old, low-play rows fill the retained top-100 slot with 99 of them,
    // so exactly one old row falls outside the protection.
    for (let index = 0; index < 100; index++) {
        await prisma.statsTrack.create({
            data: { guildId: 'g1', trackId: `old-${index}`, title: `Old ${index}`, author: 'A', source: 'deezer', seconds: 1, plays: 1, lastPlayed: old },
        });
    }
    await prisma.statsListener.create({ data: { guildId: 'g1', userId: 'top', seconds: 500, lastSeen: old } });
    await prisma.statsListener.create({ data: { guildId: 'g1', userId: 'new', seconds: 2, lastSeen: recent } });
    for (let index = 0; index < 100; index++) {
        await prisma.statsListener.create({
            data: { guildId: 'g1', userId: `old-${index}`, seconds: 1, lastSeen: old },
        });
    }
    await prisma.sessionLease.create({ data: { guildId: 'expired', botId: 'b', botName: 'B', expiresAt: old, updatedAt: old } });
    await prisma.sessionLease.create({ data: { guildId: 'live', botId: 'b', botName: 'B', expiresAt: new Date('2026-06-01T13:00:00Z'), updatedAt: now } });

    const result = await db.pruneStats({ now, retentionDays: 90, inactiveDays: 180 });
    assert.deepEqual(result, { daily: 1, tracks: 3, listeners: 2, leases: 1 });
    assert.equal((await prisma.statsDaily.count()), 1);
    assert.equal((await prisma.statsTrack.count()), 100);
    assert.equal((await prisma.statsListener.count()), 100);
    assert.equal((await prisma.statsTrack.findUnique({ where: { guildId_trackId: { guildId: 'g1', trackId: 'top' } } }))?.seconds, 1000);
    assert.equal((await prisma.statsTrack.findUnique({ where: { guildId_trackId: { guildId: 'g1', trackId: 'new' } } }))?.seconds, 5);
    assert.equal((await prisma.statsListener.findUnique({ where: { guildId_userId: { guildId: 'g1', userId: 'top' } } }))?.seconds, 500);
    assert.equal((await prisma.statsListener.findUnique({ where: { guildId_userId: { guildId: 'g1', userId: 'new' } } }))?.seconds, 2);
    assert.equal((await prisma.sessionLease.count()), 1);
});
