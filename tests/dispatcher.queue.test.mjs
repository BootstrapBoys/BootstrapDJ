import assert from 'node:assert/strict';
import test from 'node:test';

import Dispatcher from '../dist/core/Dispatcher.js';
import { makeDispatcher, makeSong } from './helpers.mjs';

test('clearQueueEmptyPrompt stops its collector before deleting the message', () => {
    const calls = [];
    const dispatcher = Object.create(Dispatcher.prototype);
    Object.assign(dispatcher, {
        queueEmptyPrompt: { delete: async () => calls.push('delete') },
        queueEmptyCollector: { stop: reason => calls.push(`stop:${reason}`) },
    });

    dispatcher.clearQueueEmptyPrompt();

    assert.equal(dispatcher.queueEmptyPrompt, null);
    assert.equal(dispatcher.queueEmptyCollector, null);
    assert.deepEqual(calls, ['stop:cleared', 'delete']);
});

test('a queue purge with nothing to remove does not write a snapshot', () => {
    let saves = 0;
    const dispatcher = makeDispatcher({
        queue: [makeSong('user')],
        persist: async () => {
            saves += 1;
        },
    });

    assert.equal(dispatcher.purgeAutoplay(), 0);
    assert.equal(saves, 0);
});

test('a user request purges filler and persists the final queue once', () => {
    let saves = 0;
    const dispatcher = makeDispatcher({
        autoplay: true,
        queue: [makeSong('filler', { autoplay: true })],
        persist: async () => {
            saves += 1;
        },
    });

    dispatcher.enqueue(makeSong('request'));

    assert.deepEqual(
        dispatcher.queue.map(track => track.info.title),
        ['request']
    );
    assert.equal(saves, 1);
});

test('disabling autoplay purges filler and persists once', async () => {
    let saves = 0;
    const dispatcher = makeDispatcher({
        autoplay: true,
        queue: [makeSong('filler', { autoplay: true }), makeSong('user')],
        persist: async () => {
            saves += 1;
        },
    });

    await dispatcher.setAutoplay(false);

    assert.deepEqual(
        dispatcher.queue.map(track => track.info.title),
        ['user']
    );
    assert.equal(saves, 1);
});
