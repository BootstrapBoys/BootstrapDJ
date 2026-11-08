import assert from 'node:assert/strict';
import test from 'node:test';

import { DestroyCoordinator } from '../dist/core/player/DestroyCoordinator.js';
import { PlaybackTimers } from '../dist/core/player/PlaybackTimers.js';

function makeTimers() {
    const timers = new PlaybackTimers();
    timers.persist = setInterval(() => {}, 60_000);
    timers.stats = setInterval(() => {}, 60_000);
    timers.pause = setTimeout(() => {}, 60_000);
    timers.idle = setTimeout(() => {}, 60_000);
    timers.persist.unref();
    timers.stats.unref();
    timers.pause.unref();
    timers.idle.unref();
    return timers;
}

function harness({
    current = true,
    isCurrent = true,
    shuttingDown = false,
    stopped = false,
    idle = false,
    leaveDelay = 0,
} = {}) {
    const calls = {
        leave: 0,
        deleted: 0,
        removed: 0,
        status: 0,
        destroyed: 0,
        reset: 0,
        collector: 0,
        messages: 0,
        prompt: 0,
    };
    const timers = makeTimers();
    let currentEntry = isCurrent;
    let idleNow = idle;
    const host = {
        guildId: 'guild-1',
        stopped,
        timers,
        isCurrent: () => currentEntry,
        isShuttingDown: () => shuttingDown,
        isIdle: () => idleNow,
        stopNowPlayingCollector: () => {
            calls.collector += 1;
        },
        clearNowPlayingCommandMessages: () => {
            calls.messages += 1;
        },
        clearQueueEmptyPrompt: () => {
            calls.prompt += 1;
        },
        resetPlayback: () => {
            calls.reset += 1;
        },
        deleteSession: async () => {
            calls.deleted += 1;
        },
        leave: async () => {
            calls.leave += 1;
            if (leaveDelay) await new Promise(resolve => setTimeout(resolve, leaveDelay));
        },
        removeFromQueue: () => {
            calls.removed += 1;
            currentEntry = false;
        },
        updateStatus: () => {
            calls.status += 1;
        },
        emitPlayerDestroy: () => {
            calls.destroyed += 1;
        },
    };
    const coordinator = new DestroyCoordinator(host, { info: () => {}, warn: () => {}, error: () => {} });
    return {
        coordinator,
        host,
        calls,
        timers,
        setCurrent: value => {
            currentEntry = value;
        },
        setIdle: value => {
            idleNow = value;
        },
    };
}

test('destroy clears timers, presentation and session before leaving', async () => {
    const h = harness();

    h.coordinator.destroy();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.timers.persist, null);
    assert.equal(h.timers.stats, null);
    assert.equal(h.timers.pause, null);
    assert.equal(h.timers.idle, null);
    assert.deepEqual(
        [h.calls.collector, h.calls.messages, h.calls.prompt, h.calls.reset],
        [1, 1, 1, 1]
    );
    assert.equal(h.calls.deleted, 1);
    assert.equal(h.calls.leave, 1);
    assert.equal(h.calls.removed, 1);
    assert.equal(h.calls.status, 1);
    assert.equal(h.calls.destroyed, 1);
});

test('destroy with preserveSession keeps the saved row', async () => {
    const h = harness();

    h.coordinator.destroy(true);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.calls.deleted, 0);
    assert.equal(h.calls.leave, 1);
    assert.equal(h.calls.reset, 1);
});

test('a stale dispatcher cleans its own resources but never leaves voice', async () => {
    const h = harness({ isCurrent: false });

    h.coordinator.destroy();

    assert.equal(h.timers.persist, null);
    assert.equal(h.timers.stats, null);
    assert.equal(h.timers.pause, null);
    assert.equal(h.timers.idle, null);
    assert.deepEqual([h.calls.collector, h.calls.messages, h.calls.prompt], [1, 1, 1]);
    assert.equal(h.calls.deleted, 0);
    assert.equal(h.calls.leave, 0);
    assert.equal(h.calls.removed, 0);
    assert.equal(h.calls.reset, 0);
    assert.equal(h.calls.destroyed, 0);
});

test('shutdown clears intervals and the prompt but does not leave', () => {
    const h = harness({ shuttingDown: true });

    h.coordinator.destroy();

    assert.equal(h.timers.persist, null);
    assert.equal(h.timers.stats, null);
    assert.notEqual(h.timers.pause, null);
    assert.notEqual(h.timers.idle, null);
    assert.equal(h.calls.prompt, 1);
    assert.equal(h.calls.deleted, 0);
    assert.equal(h.calls.leave, 0);
});

test('a stopped dispatcher leaves without emitting playerDestroy', async () => {
    const h = harness({ stopped: true });

    h.coordinator.destroy();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.calls.leave, 1);
    assert.equal(h.calls.destroyed, 0);
});

test('destroyAndWait resolves only after the leave request settles', async () => {
    const h = harness({ leaveDelay: 20 });
    let settled = false;

    const pending = h.coordinator.destroyAndWait().then(() => {
        settled = true;
    });
    assert.equal(settled, false);
    await pending;
    assert.equal(settled, true);
    assert.equal(h.calls.leave, 1);
});

test('calling destroy twice tears down once', async () => {
    const h = harness();

    h.coordinator.destroy();
    h.coordinator.destroy();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.calls.leave, 1);
    assert.equal(h.calls.deleted, 1);
    assert.equal(h.calls.reset, 1);
});

test('the idle timeout destroys only an idle dispatcher', async () => {
    const h = harness({ idle: false });

    h.coordinator.armIdleTimeout(0.01);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(h.calls.destroyed, 0);

    h.setIdle(true);
    h.coordinator.armIdleTimeout(0.01);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(h.calls.destroyed, 1);
});

test('clearing the idle timeout prevents teardown', async () => {
    const h = harness({ idle: true });

    h.coordinator.armIdleTimeout(0.01);
    h.coordinator.clearIdleTimeout();
    await new Promise(resolve => setTimeout(resolve, 25));

    assert.equal(h.calls.destroyed, 0);
    assert.equal(h.timers.idle, null);
});

test('pause timeout can be armed and cleared', () => {
    const h = harness();

    h.coordinator.armPauseTimeout(30, () => {});
    assert.notEqual(h.timers.pause, null);
    h.coordinator.clearPauseTimeout();
    assert.equal(h.timers.pause, null);
});
