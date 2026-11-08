import assert from 'node:assert/strict';
import test from 'node:test';

import { EmbedBuilder } from 'discord.js';

import GuildCommand from '../dist/commands/owner/Guild.js';

test('guild inspection defers before the slow owner fetch', async () => {
    const order = [];
    const guild = {
        id: 'g1',
        name: 'Guild One',
        ownerId: 'owner-1',
        memberCount: 12,
        createdAt: new Date('2020-01-01'),
        joinedAt: new Date('2021-01-01'),
        iconURL: () => null,
        members: { me: null },
        fetchOwner: async () => {
            order.push('fetchOwner');
            return null;
        },
    };
    const client = {
        guilds: { cache: new Map([['g1', guild]]) },
        user: null,
        embed: () => new EmbedBuilder(),
        color: { red: 0xff0000, main: 0x2f3136, green: 0x00ff00 },
    };
    const replies = [];
    const ctx = {
        author: { id: 'owner-1' },
        defer: async () => {
            order.push('defer');
        },
        sendMessage: async payload => {
            replies.push(payload);
            return payload;
        },
    };

    await new GuildCommand(client).run(client, ctx, ['g1']);

    assert.equal(order[0], 'defer');
    assert.equal(order[1], 'fetchOwner');
    assert.equal(replies.length, 1);
});
