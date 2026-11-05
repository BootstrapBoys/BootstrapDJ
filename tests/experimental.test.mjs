import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupeQueue, parseTime, removeRange, sortQueue } from '../dist/utils/QueueTools.js';
import { makeSong } from './helpers.mjs';

test('queue sorting is stable and supports every field', () => {
    const queue = [
        makeSong('Zulu', { author: 'B', uri: 'https://x/2' }),
        makeSong('Alpha', { author: 'C', uri: 'https://x/1' }),
        makeSong('Alpha', { author: 'A', uri: 'https://x/3' }),
    ];
    assert.deepEqual(
        sortQueue(queue, 'title', 'asc').map(track => track.info.uri),
        ['https://x/1', 'https://x/3', 'https://x/2']
    );
    assert.deepEqual(
        sortQueue(queue, 'author', 'desc').map(track => track.info.author),
        ['C', 'B', 'A']
    );
});

test('queue dedupe keeps the first occurrence and ranges use 1-based positions', () => {
    const first = makeSong('One', { uri: 'https://x/1' });
    const duplicate = makeSong('One copy', { uri: 'https://x/1' });
    const third = makeSong('Three', { uri: 'https://x/3' });
    assert.deepEqual(
        dedupeQueue([first, duplicate, third]).map(track => track.info.uri),
        ['https://x/1', 'https://x/3']
    );
    const queue = [first, third, makeSong('Four', { uri: 'https://x/4' })];
    assert.equal(removeRange(queue, 1, 2).length, 2);
    assert.equal(queue.length, 1);
});

test('parseTime accepts seconds, clock notation and unit notation', () => {
    assert.equal(parseTime('30'), 30_000);
    assert.equal(parseTime('01:30'), 90_000);
    assert.equal(parseTime('1h 2m 3s'), 3_723_000);
});
