import assert from 'node:assert/strict';
import { test } from 'node:test';

import Skip from '../dist/commands/music/Skip.js';

function harness(current, queue = []) {
    const replies = [];
    const skipCalls = [];
    const player = {
        current,
        queue,
        isStale: false,
        skip: value => skipCalls.push(value),
    };
    const client = {
        config: {},
        logger: {},
        color: { main: 0x00ff00, red: 0xff0000 },
        queue: { get: () => player },
        embed: () => ({
            setColor() {
                return this;
            },
            setDescription(description) {
                this.description = description;
                replies.push(description);
                return this;
            },
        }),
    };
    const ctx = {
        guild: { id: 'g1', channels: { cache: { get: () => null } } },
        voiceChannel: null,
        channelId: 'c1',
        isInteraction: true,
        locale: 'en-US',
        sendMessage: async payload => {
            const description = payload.embeds?.[0]?.description ?? payload.content ?? '';
            if (description) replies.push(description);
            return payload;
        },
    };
    return { command: new Skip(client), client, ctx, player, replies, skipCalls };
}

test('skip advances the current track even when the queue is empty', async () => {
    const h = harness({ info: { title: 'Only track', uri: 'https://example.test/track' } });
    await h.command.run(h.client, h.ctx, []);
    assert.equal(h.skipCalls.length, 1);
    assert.match(h.replies.at(-1), /Skipped/);
});

test('skip refuses when neither a current track nor a queue exists', async () => {
    const h = harness(null);
    await h.command.run(h.client, h.ctx, []);
    assert.equal(h.skipCalls.length, 0);
    assert.match(h.replies.at(-1), /no songs in the queue/i);
});
