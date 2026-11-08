import assert from 'node:assert/strict';
import test from 'node:test';

import { Collection, EmbedBuilder, GuildMember } from 'discord.js';

import Dj from '../dist/commands/manage/Dj.js';

function makeHarness() {
    const calls = { removed: [], mode: [], replies: [] };
    const role = { id: 'role-1', name: 'DJ' };
    const member = Object.create(GuildMember.prototype);
    Object.defineProperty(member, 'permissions', {
        value: { has: () => true },
        configurable: true,
    });
    Object.defineProperty(member, 'roles', {
        value: { cache: new Collection() },
        configurable: true,
    });
    let roles = [{ roleId: role.id }];
    const client = {
        embed: () => new EmbedBuilder(),
        color: { red: 0xff0000, green: 0x00ff00, main: 0x2f3136 },
        db: {
            getDj: async () => ({ mode: true }),
            getRoles: async () => roles,
            removeRole: async (_guildId, roleId) => {
                calls.removed.push(roleId);
                roles = roles.filter(entry => entry.roleId !== roleId);
            },
            setDj: async (_guildId, mode) => {
                calls.mode.push(mode);
            },
        },
    };
    const ctx = {
        isInteraction: false,
        interaction: null,
        guild: {
            id: 'guild',
            roles: { cache: new Collection([[role.id, role]]) },
        },
        author: { id: 'user' },
        member,
        message: { mentions: { roles: new Collection() } },
        sendMessage: async payload => {
            calls.replies.push(payload);
            return payload;
        },
    };
    return { client, ctx, calls, role };
}

test('removing the last DJ role also disables DJ mode', async () => {
    const harness = makeHarness();

    await new Dj({ config: {}, logger: {} }).run(harness.client, harness.ctx, ['remove', '<@&role-1>']);

    assert.deepEqual(harness.calls.removed, ['role-1']);
    assert.deepEqual(harness.calls.mode, [false]);
    assert.match(harness.calls.replies[0].embeds[0].data.description, /DJ mode is now disabled/);
});

test('clearing DJ roles disables DJ mode', async () => {
    const harness = makeHarness();
    harness.client.db.clearRoles = async () => {};

    await new Dj({ config: {}, logger: {} }).run(harness.client, harness.ctx, ['clear']);

    assert.deepEqual(harness.calls.mode, [false]);
});
