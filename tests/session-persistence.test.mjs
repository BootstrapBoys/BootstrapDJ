import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlaybackEngine } from '../dist/core/player/PlaybackEngine.js';
import { makeSong } from './helpers.mjs';

function harness({ holdSave = false } = {}) {
    const saves = [];
    let releaseSave = null;
    let gate = null;
    if (holdSave) {
        gate = new Promise(resolve => {
            releaseSave = resolve;
        });
    }

    const state = {
        current: makeSong('current'),
        queue: [makeSong('next')],
        history: [],
        previous: null,
        loop: 'off',
        autoplay: false,
        volume: 100,
        paused: false,
        stopped: false,
        seed: null,
        seeds: [],
        pauseWhenEmpty: false,
        paused247: false,
        failedTracks: new Map(),
    };
    const player = {
        position: 5000,
        volume: 100,
    };
    const sessions = {
        save: async snapshot => {
            saves.push(snapshot);
            if (saves.length === 1 && gate) await gate;
        },
        remove: async () => {},
    };
    const host = {
        guildId: 'guild-1',
        exists: true,
        stale: false,
        sessionTarget: () => ({ textId: 'text-1', voiceId: 'voice-1' }),
        persist: async () => {},
        scheduleRetry: () => null,
        resolveFresh: async () => null,
        restartIfIdle: () => {},
        pausePolicy: async () => ({ stay: false, seconds: 0 }),
        armPauseTimeout: () => {},
        clearPauseTimeout: () => {},
        destroy: () => {},
    };
    const ports = {
        player: {
            isAvailable: () => true,
            play: async () => {},
            pause: async () => {},
            resume: async () => {},
            seek: async () => {},
            stop: async () => {},
            setVolume: async () => {},
            position: () => player.position,
            volume: () => player.volume,
            isPaused: () => state.paused,
            hasTrack: () => Boolean(state.current),
        },
        sessions,
        logger: { warn: () => {}, error: () => {} },
        host,
    };
    return {
        engine: new PlaybackEngine(state, ports),
        state,
        player,
        saves,
        release: () => releaseSave?.(),
    };
}

test('identical snapshots do not rewrite the session', async () => {
    const h = harness();
    await h.engine.persist();
    await h.engine.persist();
    assert.equal(h.saves.length, 1);

    h.player.position = 8000;
    await h.engine.persist();
    assert.equal(h.saves.length, 2, 'a position checkpoint beyond the dedupe window writes');
});

test('queue or settings changes force a new snapshot', async () => {
    const h = harness();
    await h.engine.persist();
    h.state.queue.push(makeSong('added'));
    await h.engine.persist();
    assert.equal(h.saves.length, 2);

    h.state.autoplay = true;
    await h.engine.persist();
    assert.equal(h.saves.length, 3);
});

test('concurrent persist calls coalesce and flush the changed state', async () => {
    const h = harness({ holdSave: true });
    const first = h.engine.persist();
    h.state.queue.push(makeSong('during-save'));
    const second = h.engine.persist();

    assert.equal(h.saves.length, 1);
    h.release();
    await Promise.all([first, second]);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.saves.length, 2);
    assert.equal(h.saves[1].queue.length, 2);
});
