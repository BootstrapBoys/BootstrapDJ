import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EmbedBuilder } from 'discord.js';
import { LoadType } from 'shoukaku';

import { runPlayRequest } from '../dist/utils/PlayRequest.js';

function rawTrack(title, length = 1000) {
    return {
        encoded: `encoded-${title}`,
        info: {
            identifier: title,
            isSeekable: true,
            author: 'Artist',
            length,
            isStream: false,
            position: 0,
            title,
            uri: `https://music.example/${title}`,
            sourceName: 'deezer',
        },
    };
}

function makePlayer(initial = []) {
    return {
        queue: initial,
        current: null,
        isStale: false,
        seeded: null,
        buildTrack(raw, author) {
            return {
                encoded: raw.encoded,
                info: { ...raw.info, requester: { id: author.id } },
            };
        },
        enqueue(track) {
            this.queue.push(track);
        },
        enqueueNext(track) {
            this.queue.unshift(track);
        },
        seedPlaylist(added) {
            this.seeded = added;
        },
        async persist() {},
        async isPlaying() {},
    };
}

function makeClient(player, response, overrides = {}) {
    let created = 0;
    let searched = 0;
    return {
        queue: {
            get: () => player,
            hasNode: true,
            create: async () => {
                created += 1;
                return player;
            },
            search: async () => {
                searched += 1;
                return response;
            },
        },
        db: { getGuildSettings: async () => ({}) },
        config: { searchEngine: 'dzsearch', maxQueueSize: 100, maxPlaylistSize: 100 },
        embed: () => new EmbedBuilder(),
        color: { red: 0xff0000, main: 0x00ff00 },
        logger: { error: () => {} },
        stats: () => ({ created, searched }),
        ...overrides,
    };
}

function makeCtx() {
    const replies = [];
    return {
        replies,
        guild: { id: 'guild' },
        author: { id: 'user' },
        voiceChannel: { id: 'vc' },
        channel: { id: 'channel' },
        async sendMessage(payload) {
            replies.push(payload);
        },
    };
}

test('track requests enqueue at the end for play and at the front for playnext', async () => {
    const player = makePlayer();
    const client = makeClient(player, { loadType: LoadType.TRACK, data: rawTrack('A') });
    const ctx = makeCtx();

    await runPlayRequest(client, ctx, ['query'], 'queue');
    assert.deepEqual(player.queue.map(track => track.info.title), ['A']);
    assert.match(ctx.replies[0].embeds[0].data.description, /to the queue/);

    player.queue.length = 0;
    await runPlayRequest(client, ctx, ['query'], 'next');
    assert.deepEqual(player.queue.map(track => track.info.title), ['A']);
    assert.match(ctx.replies[1].embeds[0].data.description, /play next/);
});

test('playlist requests preserve their order in both modes and only seed play', async () => {
    const player = makePlayer();
    const client = makeClient(player, {
        loadType: LoadType.PLAYLIST,
        data: { tracks: [rawTrack('A'), rawTrack('B'), rawTrack('C')] },
    });
    const ctx = makeCtx();

    await runPlayRequest(client, ctx, ['query'], 'queue');
    assert.deepEqual(player.queue.map(track => track.info.title), ['A', 'B', 'C']);
    assert.deepEqual(player.seeded.map(track => track.info.title), ['A', 'B', 'C']);

    player.queue.length = 0;
    player.seeded = null;
    await runPlayRequest(client, ctx, ['query'], 'next');
    assert.deepEqual(player.queue.map(track => track.info.title), ['A', 'B', 'C']);
    assert.equal(player.seeded, null);
});

test('missing Lavalink nodes are rejected without creating a player', async () => {
    const player = makePlayer();
    const client = makeClient(player, null);
    client.queue.hasNode = false;
    const ctx = makeCtx();

    await runPlayRequest(client, ctx, ['query'], 'next');
    assert.equal(client.stats().created, 0);
    assert.equal(client.stats().searched, 0);
    assert.match(ctx.replies[0].embeds[0].data.description, /No Lavalink node/);
});

test('empty, error and null search responses reply once', async () => {
    for (const response of [
        { loadType: LoadType.EMPTY, data: {} },
        { loadType: LoadType.ERROR, data: { message: 'boom' } },
        null,
    ]) {
        const ctx = makeCtx();
        await runPlayRequest(makeClient(makePlayer(), response), ctx, ['query'], 'queue');
        assert.equal(ctx.replies.length, 1);
    }
});

test('a search response uses its first track', async () => {
    const player = makePlayer();
    const client = makeClient(player, {
        loadType: LoadType.SEARCH,
        data: [rawTrack('First'), rawTrack('Second')],
    });
    const ctx = makeCtx();

    await runPlayRequest(client, ctx, ['query'], 'queue');
    assert.deepEqual(player.queue.map(track => track.info.title), ['First']);
});

test('track limits and queue caps reject before enqueueing', async () => {
    const player = makePlayer([rawTrack('existing')]);
    const settings = async () => ({ maxtracklength: '1' });
    const client = makeClient(player, { loadType: LoadType.TRACK, data: rawTrack('Long', 2000) });
    client.db.getGuildSettings = settings;
    const ctx = makeCtx();

    await runPlayRequest(client, ctx, ['query'], 'queue');
    assert.equal(player.queue.length, 1);
    assert.match(ctx.replies[0].embeds[0].data.description, /longer/);

    const capped = makePlayer([rawTrack('existing')]);
    const cappedClient = makeClient(capped, { loadType: LoadType.TRACK, data: rawTrack('A') });
    cappedClient.config.maxQueueSize = 0;
    const cappedCtx = makeCtx();
    await runPlayRequest(cappedClient, cappedCtx, ['query'], 'queue');
    assert.equal(capped.queue.length, 1);
    assert.match(cappedCtx.replies[0].embeds[0].data.description, /queue is too long/);
});

test('playlist limits and rejected tracks are reflected in the reply count', async () => {
    const player = makePlayer();
    const client = makeClient(player, {
        loadType: LoadType.PLAYLIST,
        data: { tracks: [rawTrack('Long', 2000), rawTrack('Short', 500)] },
    });
    client.db.getGuildSettings = async () => ({ maxtracklength: '1' });
    const ctx = makeCtx();

    await runPlayRequest(client, ctx, ['query'], 'queue');
    assert.deepEqual(player.queue.map(track => track.info.title), ['Short']);
    assert.match(ctx.replies[0].embeds[0].data.description, /Added 1 songs/);

    const oversized = makeClient(makePlayer(), {
        loadType: LoadType.PLAYLIST,
        data: { tracks: [rawTrack('A'), rawTrack('B')] },
    });
    oversized.config.maxPlaylistSize = 1;
    const oversizedCtx = makeCtx();
    await runPlayRequest(oversized, oversizedCtx, ['query'], 'queue');
    assert.match(oversizedCtx.replies[0].embeds[0].data.description, /playlist is too long/);
});
