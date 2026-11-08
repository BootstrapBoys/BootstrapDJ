import assert from 'node:assert/strict';
import test from 'node:test';

import { EmbedBuilder } from 'discord.js';

import Join from '../dist/commands/music/Join.js';
import Leave from '../dist/commands/music/Leave.js';

function clientWith(queue = new Map(), created = null) {
    return {
        queue: Object.assign(queue, {
            create: async () => created,
        }),
        shoukaku: { options: { nodeResolver: () => null }, nodes: new Map() },
        embed: () => new EmbedBuilder(),
        color: { red: 0xff0000, main: 0x2f3136 },
    };
}

function context() {
    const replies = [];
    return {
        guild: { id: 'g1', channels: { cache: new Map() } },
        voiceChannel: { id: 'voice-2' },
        channel: { id: 'text-1' },
        replies,
        sendMessage: async payload => {
            replies.push(payload);
            return payload;
        },
        description: () => replies[0].embeds[0].data.description,
    };
}

test('join names the live channel instead of formatting undefined', async () => {
    const player = {
        isStale: false,
        voiceId: null,
        node: { manager: { connections: new Map([['g1', { channelId: 'voice-1' }]]) } },
    };
    const client = clientWith(new Map([['g1', player]]));
    const ctx = context();

    await new Join(client).run(client, ctx, []);

    assert.equal(ctx.description(), "I'm already connected to <#voice-1>");
});

test('join falls back to a plain label when the channel id is unknown', async () => {
    const player = {
        isStale: false,
        voiceId: null,
        node: { manager: { connections: new Map() } },
    };
    const client = clientWith(new Map([['g1', player]]));
    const ctx = context();

    await new Join(client).run(client, ctx, []);

    assert.equal(ctx.description(), "I'm already connected to the voice channel");
});

test('join after create uses the created dispatcher voice id', async () => {
    const created = { voiceId: 'voice-2', node: { manager: { connections: new Map() } } };
    const client = clientWith(new Map(), created);
    const ctx = context();

    await new Join(client).run(client, ctx, []);

    assert.equal(ctx.description(), 'Joined <#voice-2>');
});

test('leave destroys the player even when the reply fails', async () => {
    let destroyed = 0;
    const player = {
        voiceId: 'voice-1',
        node: { manager: { connections: new Map() } },
        destroy: () => {
            destroyed += 1;
        },
    };
    const client = clientWith(new Map([['g1', player]]));
    const ctx = context();
    ctx.sendMessage = async () => {
        throw new Error('Discord 500');
    };

    await assert.rejects(() => new Leave(client).run(client, ctx, []), /Discord 500/);
    assert.equal(destroyed, 1);
});
