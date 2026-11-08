import assert from 'node:assert/strict';
import test from 'node:test';
import { LoadType } from 'shoukaku';

import { Queue } from '../dist/core/Queue.js';

function makeQueue(node) {
    const queue = Object.create(Queue.prototype);
    queue.client = {
        shoukaku: {
            nodes: new Map([[node.name, node]]),
            options: { nodeResolver: pool => pool.get(node.name) },
        },
        config: { searchEngine: 'dzsearch' },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        db: {},
    };
    return queue;
}

function response(loadType = LoadType.SEARCH, title = 'track') {
    return {
        loadType,
        data: [{ encoded: title, info: { title, uri: `https://x/${title}` } }],
    };
}

function makeNode(name, resolve) {
    return { name, rest: { resolve } };
}

test('search prefixes a plain query with the configured engine', async () => {
    const calls = [];
    const node = makeNode('primary', async identifier => {
        calls.push(identifier);
        return response(LoadType.SEARCH, 'fear');
    });
    const result = await makeQueue(node).search('nf fear');

    assert.deepEqual(calls, ['dzsearch:nf fear']);
    assert.equal(result.loadType, LoadType.SEARCH);
});

test('search leaves absolute URLs and explicit engine prefixes alone', async () => {
    const calls = [];
    const node = makeNode('primary', async identifier => {
        calls.push(identifier);
        return response();
    });
    const queue = makeQueue(node);

    await queue.search('https://example.com/playlist');
    await queue.search('ytsearch:already prefixed');

    assert.deepEqual(calls, ['https://example.com/playlist', 'ytsearch:already prefixed']);
});

test('search retries an empty fallback node with ytsearch', async () => {
    const calls = [];
    const node = makeNode('public-music', async identifier => {
        calls.push(identifier);
        return calls.length === 1 ? response(LoadType.EMPTY) : response(LoadType.SEARCH, 'ok');
    });
    const result = await makeQueue(node).search('nf fear');

    assert.deepEqual(calls, ['dzsearch:nf fear', 'ytsearch:nf fear']);
    assert.equal(result.loadType, LoadType.SEARCH);
});

test('search returns null when the Lavalink resolve throws', async () => {
    const node = makeNode('primary', async () => {
        throw new Error('session not found');
    });
    const result = await makeQueue(node).search('nf fear');

    assert.equal(result, null);
});

test('search returns null when no node is connected', async () => {
    const queue = makeQueue(makeNode('primary', async () => response()));
    queue.client.shoukaku.nodes.clear();

    assert.equal(await queue.search('nf fear'), null);
});
