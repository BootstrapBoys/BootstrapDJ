import assert from 'node:assert/strict';
import test from 'node:test';

import { makeDispatcher, makeSong, view } from './helpers.mjs';

function playbackDispatcher(overrides = {}) {
    const dispatcher = makeDispatcher({
        current: null,
        queue: [],
        failedTracks: new Map(),
        paused247: false,
        restoring: false,
        voiceId: 'voice-1',
        channelId: 'text-1',
        ...overrides,
    });
    dispatcher.client.queue = new Map([[dispatcher.guildId, dispatcher]]);
    dispatcher.client.db.saveSession = async () => {};
    dispatcher.client.db.deleteSession = async () => {};
    dispatcher.client.db.get_247 = async () => null;
    dispatcher.client.db.getGuildSettings = async () => ({});
    dispatcher.persist = async () => {};
    const calls = { play: 0, stop: 0, pause: [], seek: [] };
    dispatcher.player = {
        position: 0,
        volume: 100,
        paused: false,
        playTrack: async () => {
            calls.play += 1;
        },
        stopTrack: async () => {
            calls.stop += 1;
        },
        setPaused: async value => {
            calls.pause.push(value);
        },
        seekTo: async value => {
            calls.seek.push(value);
        },
    };
    Object.defineProperty(dispatcher, 'exists', { configurable: true, value: true });
    Object.defineProperty(dispatcher, 'isStale', { configurable: true, value: false });
    dispatcher.calls = calls;
    return dispatcher;
}

test('play takes the queue head, starts it, and records history', async () => {
    const first = makeSong('first', { uri: 'https://x/first' });
    const second = makeSong('second', { uri: 'https://x/second' });
    const dispatcher = playbackDispatcher({ queue: [first, second] });

    await dispatcher.play();

    assert.equal(dispatcher.current, first);
    assert.equal(dispatcher.calls.play, 1);
    assert.equal(dispatcher.calls.stop, 0);
    assert.deepEqual(dispatcher.history.map(track => track.info.title), ['first']);
    assert.equal(view(dispatcher), 'second');
});

test('play is a no-op with an empty queue and no current track', async () => {
    const dispatcher = playbackDispatcher();

    await dispatcher.play();

    assert.equal(dispatcher.current, null);
    assert.equal(dispatcher.calls.play, 0);
});

test('a failed track is requeued below the three-failure limit', async () => {
    const track = makeSong('broken', { uri: 'https://x/broken' });
    const dispatcher = playbackDispatcher({ current: track });
    dispatcher.player.playTrack = async () => {
        throw new Error('unplayable');
    };
    dispatcher.resolveFresh = async () => null;

    await dispatcher.play(4);

    assert.equal(dispatcher.current, null);
    assert.equal(dispatcher.failedTracks.get(track.info.uri), 1);
    assert.equal(view(dispatcher), 'broken');
});

test('the third failed attempt drops the track instead of requeueing it', async () => {
    const track = makeSong('broken', { uri: 'https://x/broken' });
    const dispatcher = playbackDispatcher({ current: track });
    dispatcher.failedTracks.set(track.info.uri, 2);
    dispatcher.player.playTrack = async () => {
        throw new Error('unplayable');
    };
    dispatcher.resolveFresh = async () => null;

    await dispatcher.play(4);

    assert.equal(dispatcher.current, null);
    assert.equal(dispatcher.failedTracks.has(track.info.uri), false);
    assert.equal(view(dispatcher), '');
});

test('pause toggles the player and persists without a timeout when 24/7 is off', async () => {
    const dispatcher = playbackDispatcher();
    let persisted = 0;
    dispatcher.persist = async () => {
        persisted += 1;
    };

    dispatcher.pause();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(dispatcher.calls.pause, [true]);
    assert.equal(dispatcher.paused, true);
    assert.equal(dispatcher.timers.pause, null);

    dispatcher.pause();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(dispatcher.calls.pause, [true, false]);
    assert.equal(dispatcher.paused, false);
    assert.equal(persisted, 2);
});

test('skip trims the requested number of queued tracks and stops the player', async () => {
    const dispatcher = playbackDispatcher({
        queue: [makeSong('a'), makeSong('b'), makeSong('c')],
    });

    await dispatcher.skip(2);

    // c8: skip(2) drops one queued entry; the current track supplies the other skip.
    assert.equal(view(dispatcher), 'b, c');
    assert.equal(dispatcher.calls.stop, 1);
});

test('seek forwards the exact position to the player', () => {
    const dispatcher = playbackDispatcher();

    dispatcher.seek(42000);
    assert.deepEqual(dispatcher.calls.seek, [42000]);
});

test('stop clears queue, history, loop, autoplay, seeds, and deletes the session', async () => {
    const dispatcher = playbackDispatcher({
        queue: [makeSong('a')],
        history: [makeSong('old')],
        loop: 'queue',
        autoplay: true,
        seed: makeSong('seed'),
        seeds: [makeSong('seed')],
    });
    let deleted = 0;
    dispatcher.client.db.deleteSession = async () => {
        deleted += 1;
    };

    dispatcher.stop();

    assert.equal(view(dispatcher), '');
    assert.deepEqual(dispatcher.history, []);
    assert.equal(dispatcher.loop, 'off');
    assert.equal(dispatcher.autoplay, false);
    assert.equal(dispatcher.seed, null);
    assert.deepEqual(dispatcher.seeds, []);
    assert.equal(dispatcher.stopped, true);
    assert.equal(deleted, 1);
    assert.equal(dispatcher.calls.stop, 1);
});

test('pause arms the configured pause timeout through the engine adapter', async () => {
    const dispatcher = playbackDispatcher();
    dispatcher.client.db.getGuildSettings = async () => ({ timeoutpause: '2' });

    dispatcher.pause();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.notEqual(dispatcher.timers.pause, null);

    dispatcher.pause();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dispatcher.timers.pause, null);
});
