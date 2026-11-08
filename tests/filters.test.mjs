import assert from 'node:assert/strict';
import test from 'node:test';

import { EmbedBuilder } from 'discord.js';

import { numericFilter, toggleFilter } from '../dist/lib/filterCommand.js';

function harness() {
    const replies = [];
    const player = { filters: [], filterValues: {}, player: {} };
    const client = {
        embed: () => new EmbedBuilder(),
        color: { main: 0x2f3136, red: 0xff0000, green: 0x00ff00 },
        logger: { warn: () => {} },
    };
    const ctx = {
        sendMessage: async payload => {
            replies.push(payload);
            return payload;
        },
    };
    return {
        player,
        client,
        ctx,
        replies,
        description: () => {
            const embed = replies[0].embeds[0];
            return embed.data?.description ?? embed.description;
        },
    };
}

test('toggleFilter awaits a rejected Lavalink write and does not claim success', async () => {
    const h = harness();
    const run = toggleFilter(
        'bassboost',
        'Bassboost',
        async () => {
            throw new Error('lavalink 500 secret');
        },
        () => {}
    );

    await run({ client: h.client, ctx: h.ctx, player: h.player, args: [] });

    assert.deepEqual(h.player.filters, [], 'state is unchanged after a failed write');
    assert.match(h.description(), /Could not update the Bassboost filter/);
    assert.doesNotMatch(h.description(), /lavalink 500 secret/);
});

test('toggleFilter applies state only after the write resolves', async () => {
    const h = harness();
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    const run = toggleFilter(
        'karaoke',
        'Karaoke',
        async () => {
            await gate;
        },
        () => {}
    );

    const pending = run({ client: h.client, ctx: h.ctx, player: h.player, args: [] });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.player.filters, []);
    assert.equal(h.replies.length, 0);

    release();
    await pending;
    assert.deepEqual(h.player.filters, ['karaoke']);
    assert.match(h.description(), /enabled/);
});

test('numericFilter rejects a failed write without leaking the error', async () => {
    const h = harness();
    const run = numericFilter({
        key: 'pitch',
        min: 1,
        max: 5,
        invalid: 'bad',
        outOfRange: 'range',
        apply: async () => {
            throw new Error('raw lavalink failure');
        },
        success: value => `Pitch ${value}`,
    });

    await run({ client: h.client, ctx: h.ctx, player: h.player, args: ['2'] });

    assert.deepEqual(h.player.filters, []);
    assert.deepEqual(h.player.filterValues, {});
    assert.match(h.description(), /Could not update the pitch filter/);
    assert.doesNotMatch(h.description(), /raw lavalink failure/);
});
