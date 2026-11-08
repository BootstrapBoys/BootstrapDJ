import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { cancelEndTime, scheduleEndTime } from '../dist/commands/music/EndTime.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a second endtime replaces the first timer and listener', async () => {
    const player = new EventEmitter();
    const calls = [];

    scheduleEndTime('guild-1', player, 10, () => calls.push('first'));
    assert.equal(player.listenerCount('end'), 1);

    scheduleEndTime('guild-1', player, 30, () => calls.push('second'));
    assert.equal(player.listenerCount('end'), 1, 'the old end listener is removed');

    await wait(60);

    assert.deepEqual(calls, ['second']);
    assert.equal(player.listenerCount('end'), 0);
});

test('a natural track end cancels the pending stop-at', async () => {
    const player = new EventEmitter();
    const calls = [];

    scheduleEndTime('guild-1', player, 20, () => calls.push('stop'));
    player.emit('end');

    await wait(40);

    assert.deepEqual(calls, []);
});

test('cancelEndTime removes both the timer and the listener', async () => {
    const player = new EventEmitter();
    let fired = 0;

    scheduleEndTime('guild-1', player, 15, () => {
        fired += 1;
    });
    cancelEndTime('guild-1');

    assert.equal(player.listenerCount('end'), 0);
    await wait(40);
    assert.equal(fired, 0);
});
