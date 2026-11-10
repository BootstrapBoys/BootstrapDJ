import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadPlaylist } from '../dist/dashboard/playlists.js';

function track(title) {
    return {
        encoded: `encoded:${title}`,
        info: {
            title,
            author: 'Artist',
            length: 60_000,
            uri: `https://example.test/${title}`,
            sourceName: 'youtube',
        },
    };
}

function harness(titles) {
    const rows = titles.map((title, index) => ({
        id: String(index),
        track: JSON.stringify(track(title)),
        trackKey: `key:${title}`,
    }));
    const player = {
        isStale: false,
        queue: [],
        current: null,
        seeded: null,
        buildTrack: (entry, requester) => ({ ...entry, requester }),
        enqueue: song => player.queue.push(song),
        seedPlaylist: songs => {
            player.seeded = songs;
        },
        isPlaying: async () => {},
    };
    const client = {
        config: { maxQueueSize: 0 },
        queue: new Map([['g1', player]]),
        db: {
            getSong: async () => rows,
            getGuildSettings: async () => ({}),
        },
        users: { fetch: async () => ({ id: 'user' }) },
    };
    return { client, player, rows };
}

test('normal playlist load preserves the saved order', async () => {
    const { client, player, rows } = harness(['A', 'B', 'C']);
    const result = await loadPlaylist(client, 'g1', 'user', 'List');

    assert.equal(result.ok, true);
    assert.deepEqual(
        player.queue.map(song => song.info.title),
        ['A', 'B', 'C']
    );
    assert.deepEqual(
        player.seeded.map(song => song.info.title),
        ['A', 'B', 'C']
    );
    assert.equal(result.shuffled, false);
    assert.deepEqual(
        rows.map(row => JSON.parse(row.track).info.title),
        ['A', 'B', 'C']
    );
});

test('shuffled load changes only the in-memory queue order', async () => {
    const titles = ['A', 'B', 'C', 'D', 'E', 'F'];
    const { client, player, rows } = harness(titles);
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
        const result = await loadPlaylist(client, 'g1', 'user', 'List', true);

        assert.equal(result.ok, true);
        assert.equal(result.shuffled, true);
        assert.notDeepEqual(
            player.queue.map(song => song.info.title),
            titles
        );
        assert.deepEqual([...player.queue.map(song => song.info.title)].sort(), [...titles].sort());
        assert.deepEqual(
            player.seeded.map(song => song.info.title),
            player.queue.map(song => song.info.title)
        );
        assert.deepEqual(
            rows.map(row => JSON.parse(row.track).info.title),
            titles
        );
    } finally {
        Math.random = originalRandom;
    }
});
