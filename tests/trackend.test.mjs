import assert from 'node:assert/strict';
import test from 'node:test';

import { makeSong } from './helpers.mjs';
import TrackEnd from '../dist/events/player/TrackEnd.js';

function makeHarness() {
    const calls = { deleted: 0, played: 0 };
    const track = makeSong('last', { uri: 'https://x/last' });
    const dispatcher = {
        guildId: 'guild-1',
        current: track,
        queue: [],
        history: [],
        previous: null,
        loop: 'off',
        autoplay: false,
        pauseWhenEmpty: false,
        paused247: false,
        nowPlayingCollector: null,
        nowPlayingMessage: null,
        clearNowPlayingCommandMessages: () => {},
        play: async () => {
            calls.played += 1;
            dispatcher.current = null;
        },
        deleteSession: async () => {
            calls.deleted += 1;
        },
    };
    const client = {
        guilds: { cache: new Map() },
        logger: { warn: () => {}, error: () => {} },
        utils: { updateStatus: () => {} },
        db: {
            recordTrackPlay: async () => {},
            getSetup: async () => null,
            get_247: async () => null,
        },
    };
    const event = new TrackEnd(client, 'events/player/TrackEnd.js');
    return { event, client, dispatcher, track, calls };
}

test('a naturally drained queue deletes the saved session', async () => {
    const harness = makeHarness();

    await harness.event.run({}, harness.track, harness.dispatcher, 'finished');

    assert.equal(harness.calls.played, 1);
    assert.equal(harness.calls.deleted, 1);
});

test('a queue that still has a track keeps the saved session', async () => {
    const harness = makeHarness();
    harness.dispatcher.queue.push(makeSong('next'));
    harness.dispatcher.play = async () => {
        harness.calls.played += 1;
        harness.dispatcher.current = harness.dispatcher.queue.shift() ?? null;
    };

    await harness.event.run({}, harness.track, harness.dispatcher, 'finished');

    assert.equal(harness.calls.played, 1);
    assert.equal(harness.calls.deleted, 0);
});

test('autoplay that found nothing also clears the ended snapshot', async () => {
    const harness = makeHarness();
    harness.dispatcher.autoplay = true;
    harness.dispatcher.ensureLookahead = async () => null;

    await harness.event.run({}, harness.track, harness.dispatcher, 'finished');

    assert.equal(harness.calls.deleted, 1);
});
