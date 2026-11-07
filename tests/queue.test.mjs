import assert from 'node:assert/strict';
import test from 'node:test';

import { makeDispatcher, makeSong, view } from './helpers.mjs';

test('enqueue drops queued bot picks and seeds from the request', () => {
    const dispatcher = makeDispatcher({ autoplay: true });
    dispatcher.queue.push(makeSong('bot1', { autoplay: true }), makeSong('bot2', { autoplay: true }));

    const request = makeSong('user1');
    dispatcher.enqueue(request);

    assert.equal(view(dispatcher), 'user1');
    assert.equal(dispatcher.seed, request);
});

test('enqueueNext puts the request at the front', () => {
    const dispatcher = makeDispatcher({ autoplay: true });
    dispatcher.queue.push(makeSong('user1'));

    const request = makeSong('user2');
    dispatcher.enqueueNext(request);

    assert.equal(view(dispatcher), 'user2, user1');
    assert.equal(dispatcher.seed, request);
});

test('with autoplay off a user request leaves the queue untouched', () => {
    const dispatcher = makeDispatcher({ autoplay: false });
    dispatcher.queue.push(makeSong('bot1'));

    dispatcher.enqueue(makeSong('user1'));

    assert.equal(view(dispatcher), 'bot1, user1');
});

test('ensureLookahead adds exactly one pick to an empty queue', async () => {
    const dispatcher = makeDispatcher({ autoplay: true });
    dispatcher.current = makeSong('playing');
    let produced = 0;
    dispatcher.pickForSeed = async () => makeSong(`bot${++produced}`, { autoplay: true });

    await dispatcher.ensureLookahead();
    await dispatcher.ensureLookahead();

    assert.equal(dispatcher.queue.length, 1);
    assert.equal(produced, 1);
});

test('ensureLookahead is a no-op while user tracks are queued', async () => {
    const dispatcher = makeDispatcher({ autoplay: true });
    dispatcher.current = makeSong('playing');
    dispatcher.queue.push(makeSong('user1'));
    let called = 0;
    dispatcher.pickForSeed = async () => {
        called++;
        return makeSong('bot1', { autoplay: true });
    };

    await dispatcher.ensureLookahead();

    assert.equal(called, 0);
    assert.equal(view(dispatcher), 'user1');
});

test('concurrent ensureLookahead calls do not double-queue', async () => {
    const dispatcher = makeDispatcher({ autoplay: true });
    dispatcher.current = makeSong('playing');
    let produced = 0;
    dispatcher.pickForSeed = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return makeSong(`bot${++produced}`, { autoplay: true });
    };

    await Promise.all([dispatcher.ensureLookahead(), dispatcher.ensureLookahead()]);

    assert.equal(dispatcher.queue.length, 1);
});

test('ensureLookahead refills after a skip consumes the pick', async () => {
    const dispatcher = makeDispatcher({ autoplay: true });
    dispatcher.current = makeSong('playing');
    let produced = 0;
    dispatcher.pickForSeed = async () => makeSong(`bot${++produced}`, { autoplay: true });

    await dispatcher.ensureLookahead();
    dispatcher.current = dispatcher.queue.shift();
    await dispatcher.ensureLookahead();

    assert.equal(view(dispatcher), 'bot2(auto)');
});


test('fairPlay round-robins the queue by requester', () => {
    const dispatcher = makeDispatcher();
    const song = (title, userId) => {
        const track = makeSong(title, { uri: `https://x/${title}` });
        track.info.requester = { id: userId };
        return track;
    };
    dispatcher.queue = [
        song('a1', 'a'),
        song('b1', 'b'),
        song('a2', 'a'),
        song('c1', 'c'),
        song('a3', 'a'),
        song('b2', 'b'),
    ];

    assert.equal(dispatcher.fairPlay(), 6);
    assert.deepEqual(
        dispatcher.queue.map(track => track.info.title),
        ['a1', 'b1', 'c1', 'a2', 'b2', 'a3']
    );
});

test('queue-empty prompt is deleted when the player is destroyed or a request arrives', () => {
    const prompt = {
        deleted: false,
        delete() {
            this.deleted = true;
            return Promise.resolve();
        },
    };
    const dispatcher = makeDispatcher({ queueEmptyPrompt: prompt });
    dispatcher.clearQueueEmptyPrompt();
    assert.equal(dispatcher.queueEmptyPrompt, null);
    assert.equal(prompt.deleted, true);

    const second = { deleted: false, delete() { this.deleted = true; return Promise.resolve(); } };
    dispatcher.queueEmptyPrompt = second;
    dispatcher.enqueue(makeSong('next'));
    assert.equal(dispatcher.queueEmptyPrompt, null);
    assert.equal(second.deleted, true);
});
