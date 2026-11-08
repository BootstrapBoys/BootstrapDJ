import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { EmbedBuilder } from 'discord.js';

import { Utils } from '../dist/lib/Utils.js';

test('livestreams report LIVE instead of dividing by zero', () => {
    assert.equal(Utils.progressBar(0, 0), '🔴 LIVE');
    assert.equal(Utils.progressBar(30, Number.POSITIVE_INFINITY), '🔴 LIVE');
    assert.equal(Utils.progressBar(30, -1), '🔴 LIVE');
});

test('bar fills proportionally', () => {
    const bar = Utils.progressBar(30, 60, 10);
    assert.equal(bar, `${'▓'.repeat(5)}${'░'.repeat(5)} 50%`);
});

test('position past the end is clamped to 100%', () => {
    const bar = Utils.progressBar(120, 60, 10);
    assert.equal(bar, `${'▓'.repeat(10)} 100%`);
});

test('formatTime renders seconds, minutes and hours', () => {
    assert.equal(Utils.formatTime(0), '0s');
    assert.equal(Utils.formatTime(1000), '1s');
    assert.equal(Utils.formatTime(9_620), '9s');
    assert.equal(Utils.formatTime(65_000), '1m 5s');
    assert.equal(Utils.formatTime(3_725_000), '1h 2m');
    assert.equal(Utils.formatTime(90_000_000), '1d 1h');
});

function pagerHarness({ isInteraction, ephemeral }) {
    const collector = new EventEmitter();
    collector.stop = () => collector.emit('end');
    const message = {
        deleted: false,
        delete: async () => {
            message.deleted = true;
        },
        createMessageComponentCollector: () => collector,
    };
    const ctx = {
        isInteraction,
        ephemeral,
        author: { id: 'user-1' },
        sendMessage: async () => message,
    };
    return { ctx, message, collector };
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
}

test('a prefix paginator is deleted when its collector ends', async () => {
    const { ctx, message, collector } = pagerHarness({
        isInteraction: false,
        ephemeral: true,
    });

    await Utils.paginate(ctx, [new EmbedBuilder(), new EmbedBuilder()]);
    collector.emit('end');
    await flush();

    assert.equal(message.deleted, true);
});

test('an ephemeral slash paginator is left to Discord', async () => {
    const { ctx, message, collector } = pagerHarness({
        isInteraction: true,
        ephemeral: true,
    });

    await Utils.paginate(ctx, [new EmbedBuilder(), new EmbedBuilder()]);
    collector.emit('end');
    await flush();

    assert.equal(message.deleted, false);
});

test('a public slash paginator is deleted when its collector ends', async () => {
    const { ctx, message, collector } = pagerHarness({
        isInteraction: true,
        ephemeral: false,
    });

    await Utils.paginate(ctx, [new EmbedBuilder(), new EmbedBuilder()]);
    collector.emit('end');
    await flush();

    assert.equal(message.deleted, true);
});

test('the paginator stop button deletes the message', async () => {
    const { ctx, message, collector } = pagerHarness({
        isInteraction: false,
        ephemeral: true,
    });

    await Utils.paginate(ctx, [new EmbedBuilder(), new EmbedBuilder()]);
    collector.emit('collect', { customId: 'stop', user: { id: 'user-1' } });
    await flush();

    assert.equal(message.deleted, true);
});
