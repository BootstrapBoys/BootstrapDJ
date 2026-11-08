import assert from 'node:assert/strict';
import test from 'node:test';

import { Queue } from '../dist/core/index.js';

function makeClient() {
    return {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
}

function makeDispatcher(id, { nodeName, current = null, queue = [] } = {}) {
    return {
        id,
        node: { name: nodeName },
        player: { node: { name: nodeName } },
        current,
        queue,
        isStale: false,
    };
}

test('migrateFromNode moves only active players bound to that node', async () => {
    const queue = new Queue(makeClient());
    const onFallback = makeDispatcher('on-fallback', {
        nodeName: 'public-a',
        current: { info: { title: 'playing' } },
    });
    const idleOnFallback = makeDispatcher('idle-fallback', { nodeName: 'public-a' });
    const onPrimary = makeDispatcher('on-primary', {
        nodeName: 'primary',
        current: { info: { title: 'other' } },
    });
    const staleWithNode = makeDispatcher('stale', {
        nodeName: undefined,
        current: { info: { title: 'stale' } },
    });
    staleWithNode.node = { name: 'public-a' };

    for (const dispatcher of [onFallback, idleOnFallback, onPrimary, staleWithNode]) {
        queue.set(dispatcher.id, dispatcher);
    }

    const rebuilt = [];
    queue.rebuild = async dispatcher => {
        rebuilt.push(dispatcher.id);
        return {};
    };

    const moved = await queue.migrateFromNode('public-a', { name: 'primary' });

    assert.equal(moved, 2);
    assert.deepEqual(rebuilt, ['on-fallback', 'stale']);
});

test('migrateFromNode refuses to move without a target node', async () => {
    const queue = new Queue(makeClient());
    queue.set(
        'g1',
        makeDispatcher('g1', { nodeName: 'public-a', current: { info: { title: 'x' } } })
    );
    queue.rebuild = async () => assert.fail('must not rebuild without a node');

    assert.equal(await queue.migrateFromNode('public-a', undefined), 0);
});
