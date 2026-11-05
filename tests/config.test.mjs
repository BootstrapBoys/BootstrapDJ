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
