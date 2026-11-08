import assert from 'node:assert/strict';
import test from 'node:test';

import { Collection, EmbedBuilder, Role } from 'discord.js';

import Permissions from '../dist/commands/manage/Permissions.js';

function roleObject(id, name) {
    const role = Object.create(Role.prototype);
    Object.defineProperty(role, 'id', { value: id, configurable: true });
    Object.defineProperty(role, 'name', { value: name, configurable: true });
    return role;
}

function makeHarness() {
    const calls = { rules: [], replies: [] };
    const role = roleObject('role-1', 'DJ');
    const client = {
        embed: () => new EmbedBuilder(),
        color: { red: 0xff0000, main: 0x2f3136 },
        commands: new Map([['play', { name: 'play' }]]),
        db: {
            getPermissionRules: async () => [],
            getGuildSetting: async () => null,
            setPermissionRule: async (guildId, command, targetId, kind, allow) => {
                calls.rules.push({ guildId, command, targetId, kind, allow });
                return { allow };
            },
            clearPermissionRules: async () => 0,
        },
    };
    const ctx = {
        isInteraction: false,
        interaction: null,
        guild: { id: 'guild', ownerId: 'owner' },
        author: { id: 'user' },
        member: null,
        message: {
            mentions: {
                users: new Collection(),
                roles: new Collection([[role.id, role]]),
            },
        },
        sendMessage: async payload => {
            calls.replies.push(payload);
            return payload;
        },
    };
    return { client, ctx, calls, role };
}

test('permissions deny works from a prefix mention', async () => {
    const harness = makeHarness();

    await new Permissions({ config: {}, logger: {} }).run(harness.client, harness.ctx, [
        'deny',
        'play',
        '<@&role-1>',
    ]);

    assert.deepEqual(harness.calls.rules, [
        { guildId: 'guild', command: 'play', targetId: 'role-1', kind: 'role', allow: false },
    ]);
    assert.match(harness.calls.replies[0].embeds[0].data.description, /Denied/);
});

test('permissions list works from the prefix path', async () => {
    const harness = makeHarness();

    await new Permissions({ config: {}, logger: {} }).run(harness.client, harness.ctx, ['list']);

    assert.match(harness.calls.replies[0].embeds[0].data.description, /No permission rules/);
});

test('an unknown permissions action is reported instead of creating a deny rule', async () => {
    const harness = makeHarness();

    await new Permissions({ config: {}, logger: {} }).run(harness.client, harness.ctx, [
        'bogus',
        'play',
        '<@&role-1>',
    ]);

    assert.deepEqual(harness.calls.rules, []);
    assert.match(harness.calls.replies[0].embeds[0].data.description, /Please use/);
});
