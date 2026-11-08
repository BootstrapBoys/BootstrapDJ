import assert from 'node:assert/strict';
import test from 'node:test';

import { PlaybackEngine } from '../dist/core/player/PlaybackEngine.js';
import { makeDispatcher, makeSong } from './helpers.mjs';

function harness(overrides = {}) {
    const state = {
        current: null,
        queue: [],
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
        ...overrides,
    };
    const calls = { play: 0, stop: 0, pause: [], seek: [], removed: [], persisted: 0, restarts: 0, volumes: [] };
    const scheduled = [];
    let pauseTimeout = null;
    let clearPauseCalls = 0;
    let destroyed = 0;

    const player = {
        available: true,
        paused: false,
        position: 5000,
        volume: 100,
        play: async () => {
            calls.play += 1;
        },
        pause: async () => {
            calls.pause.push(true);
        },
        resume: async () => {
            calls.pause.push(false);
        },
        seek: async value => {
            calls.seek.push(value);
        },
        stop: async () => {
            calls.stop += 1;
        },
        setVolume: async value => { calls.volumes.push(value); },
        positionValue: 5000,
    };

    const host = {
        guildId: 'guild-1',
        exists: true,
        stale: false,
        pauseSeconds: 0,
        stay: false,
        sessionTarget: () => ({ textId: 'text-1', voiceId: 'voice-1' }),
        persist: async () => {
            calls.persisted += 1;
        },
        scheduleRetry: (delay, task) => {
            const entry = {
                delay,
                task,
                cancelled: false,
                cancel() {
                    entry.cancelled = true;
                },
            };
            scheduled.push(entry);
            return entry;
        },
        resolveFresh: async () => null,
        restartIfIdle: () => {
            calls.restarts += 1;
        },
        pausePolicy: async () => ({ stay: host.stay, seconds: host.pauseSeconds }),
        armPauseTimeout: (seconds, onElapsed) => {
            pauseTimeout = { seconds, onElapsed };
        },
        clearPauseTimeout: () => {
            clearPauseCalls += 1;
            pauseTimeout = null;
        },
        destroy: () => {
            destroyed += 1;
        },
    };

    const ports = {
        player: {
            isAvailable: () => player.available,
            play: track => player.play(track),
            pause: () => player.pause(),
            resume: () => player.resume(),
            seek: value => player.seek(value),
            stop: () => player.stop(),
            setVolume: value => player.setVolume(value),
            position: () => player.positionValue,
            volume: () => player.volume,
            isPaused: () => player.paused,
            hasTrack: () => true,
        },
        sessions: {
            save: async () => {},
            remove: async guildId => {
                calls.removed.push(guildId);
            },
        },
        logger: { warn: () => {}, error: () => {} },
        host,
    };

    const engine = new PlaybackEngine(state, ports);
    return {
        engine,
        state,
        player,
        host,
        calls,
        scheduled,
        getPauseTimeout: () => pauseTimeout,
        getClearPauseCalls: () => clearPauseCalls,
        getDestroyed: () => destroyed,
    };
}

test('engine play takes the queue head, records history and persists', async () => {
    const first = makeSong('first', { uri: 'https://x/first' });
    const second = makeSong('second', { uri: 'https://x/second' });
    const h = harness({ queue: [first, second] });

    await h.engine.play();

    assert.equal(h.state.current, first);
    assert.equal(h.calls.play, 1);
    assert.deepEqual(h.state.history.map(track => track.info.title), ['first']);
    assert.deepEqual(h.state.queue.map(track => track.info.title), ['second']);
    assert.equal(h.calls.persisted, 1);
});

test('engine play is a no-op when the queue and current are empty', async () => {
    const h = harness();

    await h.engine.play();

    assert.equal(h.calls.play, 0);
    assert.equal(h.calls.persisted, 0);
});

test('engine play refuses a stale player without touching the queue', async () => {
    const track = makeSong('first');
    const h = harness({ queue: [track] });
    h.host.stale = true;

    await h.engine.play();

    assert.equal(h.state.current, null);
    assert.equal(h.state.queue.length, 1);
    assert.equal(h.calls.play, 0);
});

test('engine play retries a rejected URI with 3s, 6s and 9s backoff', async () => {
    const track = makeSong('broken', { uri: 'https://x/broken' });
    const h = harness({ current: track });
    h.player.play = async () => {
        throw new Error('unplayable');
    };

    await h.engine.play(1);
    assert.deepEqual(
        h.scheduled.map(entry => entry.delay),
        [3000]
    );

    h.scheduled[0].task();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(
        h.scheduled.map(entry => entry.delay),
        [3000, 6000]
    );

    h.scheduled[1].task();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(
        h.scheduled.map(entry => entry.delay),
        [3000, 6000, 9000]
    );
});

test('engine stop cancels a pending play retry and clears the current track', async () => {
    const track = makeSong('broken', { uri: 'https://x/broken' });
    const h = harness({ current: track });
    h.player.play = async () => {
        h.calls.play += 1;
        throw new Error('unplayable');
    };

    await h.engine.play(1);
    assert.equal(h.calls.play, 1);
    assert.equal(h.scheduled.length, 1);
    assert.equal(h.scheduled[0].cancelled, false);

    h.engine.stop();

    assert.equal(h.state.current, null);
    assert.equal(h.scheduled[0].cancelled, true);
    assert.deepEqual(h.calls.removed, ['guild-1']);

    // A timer that already fired must not restart the stopped track.
    h.scheduled[0].task();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.play, 1);
});

test('engine pause cancels a pending play retry', async () => {
    const track = makeSong('broken', { uri: 'https://x/broken' });
    const h = harness({ current: track });
    h.player.play = async () => {
        h.calls.play += 1;
        throw new Error('unplayable');
    };

    await h.engine.play(1);
    h.engine.pause();
    assert.equal(h.scheduled[0].cancelled, true);

    h.scheduled[0].task();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.play, 1);
});

test('engine skip cancels a pending play retry from the skipped track', async () => {
    const track = makeSong('broken', { uri: 'https://x/broken' });
    const next = makeSong('next', { uri: 'https://x/next' });
    const h = harness({ current: track, queue: [next] });
    h.player.play = async () => {
        h.calls.play += 1;
        throw new Error('unplayable');
    };

    await h.engine.play(1);
    h.engine.skip();
    assert.equal(h.scheduled[0].cancelled, true);

    h.scheduled[0].task();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.play, 1);
});

test('engine play counts the fourth failure and requeues below the drop limit', async () => {
    const track = makeSong('broken', { uri: 'https://x/broken' });
    const h = harness({ current: track });
    h.player.play = async () => {
        throw new Error('unplayable');
    };

    await h.engine.play(4);

    assert.equal(h.state.current, null);
    assert.equal(h.state.failedTracks.get(track.info.uri), 1);
    assert.deepEqual(h.state.queue.map(item => item.info.title), ['broken']);
});

test('engine play drops a track on its third counted failure', async () => {
    const track = makeSong('broken', { uri: 'https://x/broken' });
    const h = harness({ current: track });
    h.state.failedTracks.set(track.info.uri, 2);
    h.player.play = async () => {
        throw new Error('unplayable');
    };

    await h.engine.play(4);

    assert.equal(h.state.current, null);
    assert.equal(h.state.failedTracks.has(track.info.uri), false);
    assert.equal(h.state.queue.length, 0);
});

test('engine pause schedules the configured timeout only outside 24/7', async () => {
    const h = harness();
    h.host.pauseSeconds = 30;

    h.engine.pause();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(h.calls.pause, [true]);
    assert.equal(h.state.paused, true);
    assert.equal(h.getPauseTimeout()?.seconds, 30);
    assert.equal(h.calls.persisted, 1);

    h.engine.pause();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls.pause, [true, false]);
    assert.equal(h.state.paused, false);
    assert.equal(h.getClearPauseCalls(), 2);
});

test('engine pause does not schedule a timeout in 24/7 mode', async () => {
    const h = harness();
    h.host.stay = true;
    h.host.pauseSeconds = 30;

    h.engine.pause();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.getPauseTimeout(), null);
    assert.equal(h.state.paused, true);
});

test('engine pause timeout destroys the player only while still paused', async () => {
    const h = harness();
    h.host.pauseSeconds = 5;

    h.engine.pause();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    h.getPauseTimeout().onElapsed();
    assert.equal(h.getDestroyed(), 1);

    h.state.paused = false;
    h.getPauseTimeout().onElapsed();
    assert.equal(h.getDestroyed(), 1);
});

test('engine skip trims exactly skipto - 1 queued entries', () => {
    const h = harness({ queue: [makeSong('a'), makeSong('b'), makeSong('c')] });

    h.engine.skip(2);

    assert.deepEqual(h.state.queue.map(track => track.info.title), ['b', 'c']);
    assert.equal(h.calls.stop, 1);
});

test('engine skip beyond the queue empties it', () => {
    const h = harness({ queue: [makeSong('a'), makeSong('b')] });

    h.engine.skip(5);

    assert.equal(h.state.queue.length, 0);
    assert.equal(h.calls.stop, 1);
});

test('engine seek forwards the exact position', () => {
    const h = harness();

    h.engine.seek(42000);

    assert.deepEqual(h.calls.seek, [42000]);
});

test('engine stop clears transport state and removes the saved session', () => {
    const h = harness({
        queue: [makeSong('a')],
        history: [makeSong('old')],
        loop: 'queue',
        autoplay: true,
        seed: makeSong('seed'),
        seeds: [makeSong('seed')],
    });

    h.engine.stop();

    assert.equal(h.state.queue.length, 0);
    assert.deepEqual(h.state.history, []);
    assert.equal(h.state.loop, 'off');
    assert.equal(h.state.autoplay, false);
    assert.equal(h.state.seed, null);
    assert.deepEqual(h.state.seeds, []);
    assert.equal(h.state.stopped, true);
    assert.deepEqual(h.calls.removed, ['guild-1']);
    assert.equal(h.calls.stop, 1);
});

test('dispatcher setLoop delegates to the engine without duplicating state', async () => {
    const dispatcher = makeDispatcher({ loop: 'off' });
    let persisted = 0;
    dispatcher.persist = async () => {
        persisted += 1;
    };

    dispatcher.setLoop('queue');
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(dispatcher.loop, 'queue');
    assert.equal(persisted, 1);
});

test('a dropped third failure advances to the queued head on the next play', async () => {
    const broken = makeSong('broken', { uri: 'https://x/broken' });
    const next = makeSong('next', { uri: 'https://x/next' });
    const h = harness({ current: broken, queue: [next] });
    h.state.failedTracks.set(broken.info.uri, 2);
    h.player.play = async () => {
        throw new Error('unplayable');
    };

    await h.engine.play(4);
    assert.equal(h.state.current, null);
    assert.deepEqual(h.state.queue.map(track => track.info.title), ['next']);

    h.player.play = async () => {
        h.calls.play += 1;
    };
    await h.engine.play();

    assert.equal(h.state.current, next);
    assert.deepEqual(h.state.queue, []);
    assert.deepEqual(h.state.history.map(track => track.info.title), ['next']);
});

test('stop then play keeps the player volume untouched', async () => {
    const h = harness({ queue: [makeSong('a')] });
    h.player.volume = 25;
    h.state.volume = 25;

    h.engine.stop();
    h.state.queue.push(makeSong('after-stop'));
    await h.engine.play();

    assert.equal(h.state.current?.info.title, 'after-stop');
    assert.equal(h.state.volume, 25);
    assert.deepEqual(h.calls.volumes, []);
});

test('dispatcher persist writes the full snapshot through the engine', async () => {
    const dispatcher = makeDispatcher({
        voiceId: 'voice-1',
        channelId: 'text-1',
        current: makeSong('current', { uri: 'https://x/current' }),
        queue: [makeSong('queued')],
        loop: 'repeat',
        autoplay: true,
        paused: true,
        player: { position: 1234, volume: 42 },
    });
    let saved = null;
    dispatcher.client.db.saveSession = async payload => {
        saved = payload;
    };
    dispatcher.client.db.deleteSession = async () => {};

    await dispatcher.persist();

    assert.equal(saved.guildId, 'test-guild');
    assert.equal(saved.textId, 'text-1');
    assert.equal(saved.voiceId, 'voice-1');
    assert.equal(saved.loop, 'repeat');
    assert.equal(saved.autoplay, true);
    assert.equal(saved.paused, true);
    assert.equal(saved.volume, 42);
    assert.equal(JSON.parse(saved.current).position, 1234);
    assert.equal(JSON.parse(saved.queue).length, 1);
});

test('a new start clears the stopped flag so the next destroy emits playerDestroy', async () => {
    const h = harness({ queue: [makeSong('fresh')], stopped: true });

    await h.engine.play();

    assert.equal(h.calls.play, 1);
    assert.equal(h.state.stopped, false);
});
