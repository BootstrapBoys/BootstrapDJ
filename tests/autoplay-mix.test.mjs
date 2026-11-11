import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LoadType } from 'shoukaku';

import { performanceSnapshot } from '../dist/lib/PerformanceCounters.js';
import { relatedTracks } from '../dist/core/player/YouTubeMix.js';
import { makeSong } from './helpers.mjs';

function uniqueSeed(name) {
    const title = `${name}-${Date.now()}-${Math.random()}`;
    return makeSong(title, {
        uri: `https://example.test/${encodeURIComponent(title)}`,
        identifier: title,
        sourceName: 'youtube',
    });
}

test('concurrent autoplay mix requests share one resolve', async () => {
    const seed = uniqueSeed('coalesce');
    let resolves = 0;
    let youtubeLooks = 0;
    const host = {
        youtubeIdFor: async () => {
            youtubeLooks += 1;
            return 'video-1';
        },
        node: {
            rest: {
                resolve: async () => {
                    resolves += 1;
                    await new Promise(resolve => setTimeout(resolve, 20));
                    return {
                        loadType: LoadType.PLAYLIST,
                        data: { tracks: [{ encoded: 'track-1' }] },
                    };
                },
            },
        },
    };

    const before = performanceSnapshot().autoplayCoalesced;
    const [first, second] = await Promise.all([
        relatedTracks(seed, host),
        relatedTracks(seed, host),
    ]);

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(resolves, 1);
    assert.equal(youtubeLooks, 1);
    assert.equal(performanceSnapshot().autoplayCoalesced, before + 1);
});

test('a failed mix is remembered briefly instead of retried immediately', async () => {
    const seed = uniqueSeed('negative');
    let looks = 0;
    const host = {
        youtubeIdFor: async () => {
            looks += 1;
            return null;
        },
        node: { rest: { resolve: async () => null } },
    };

    assert.deepEqual(await relatedTracks(seed, host), []);
    assert.deepEqual(await relatedTracks(seed, host), []);
    assert.equal(looks, 1);
});
