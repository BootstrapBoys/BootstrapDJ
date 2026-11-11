import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlayerStateCache } from '../dist/dashboard/playerCache.js';

const player = {
    title: 'Track',
    author: 'Artist',
    duration: 120_000,
    position: 1_000,
    queueLength: 0,
    upcoming: [],
    volume: 100,
    paused: false,
    loop: 'off',
    autoplay: false,
    activeFilters: [],
    filterValues: {},
};

function hostWithCounter() {
    const host = {
        calls: 0,
        player: async () => {
            host.calls += 1;
            return { found: true, player };
        },
    };
    return host;
}

test('concurrent player reads share one upstream request', async () => {
    const host = hostWithCounter();
    const cache = new PlayerStateCache({ refreshMs: 1_000, staleMaxMs: 10_000 });

    const results = await Promise.all(Array.from({ length: 10 }, () => cache.read(host, 'guild')));

    assert.equal(host.calls, 1);
    assert.equal(results[0].player?.title, 'Track');
});

test('a cached snapshot is served until it is invalidated', async () => {
    const host = hostWithCounter();
    const cache = new PlayerStateCache({ refreshMs: 1_000, staleMaxMs: 10_000 });

    await cache.read(host, 'guild');
    await cache.read(host, 'guild');
    assert.equal(host.calls, 1);

    cache.invalidate('guild');
    await cache.read(host, 'guild');
    assert.equal(host.calls, 2);
});

test('a stale snapshot is served while one refresh happens', async () => {
    const host = hostWithCounter();
    const cache = new PlayerStateCache({ refreshMs: 1, staleMaxMs: 10_000 });

    await cache.read(host, 'guild');
    await new Promise(resolve => setTimeout(resolve, 5));
    await cache.read(host, 'guild');
    await new Promise(resolve => setTimeout(resolve, 5));

    assert.equal(host.calls, 2);
});
