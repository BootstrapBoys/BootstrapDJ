import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeWatchdog } from '../dist/plugin/plugins/reconnectNodes.js';

function restError(status, message) {
    return Object.assign(new Error(message), { name: 'RestError', status });
}

function makeClient(getPlayers, { sessionId = 'live-session', state = 1 } = {}) {
    const calls = { disconnect: [], probes: 0 };
    const node = {
        name: 'primary',
        state,
        sessionId,
        rest: {
            getPlayers: async () => {
                calls.probes += 1;
                return await getPlayers();
            },
        },
        disconnect: (code, reason) => {
            calls.disconnect.push([code, reason]);
            node.state = 2;
        },
    };
    const client = {
        config: {
            lavalink: [{ name: 'primary', url: 'wss://node.example/v4/websocket' }],
            nodeFallback: false,
            nodeFallbackAfter: 180,
            defaultLanguage: 'en',
        },
        isReady: () => true,
        logger: {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
            success: () => {},
        },
        shoukaku: { nodes: new Map([['primary', node]]), addNode: () => {} },
        queue: {
            hasNode: false,
            values: () => [],
            get: () => undefined,
            holdPositions: () => {},
            migrateToNode: async () => 0,
        },
    };
    return { client, calls, node };
}

async function runTick(client) {
    const watchdog = new NodeWatchdog(client);
    watchdog.tick();
    // The probe is fire-and-forget so a slow REST call cannot stall the tick.
    await new Promise(resolve => setImmediate(resolve));
    return watchdog;
}

test('a stale Lavalink session recycles the node', async () => {
    const { client, calls } = makeClient(async () => {
        throw restError(404, 'Session not found');
    });
    await runTick(client);
    assert.deepEqual(calls.disconnect, [[1000, 'stale session']]);
});

test('a live session leaves the node alone', async () => {
    const { client, calls } = makeClient(async () => []);
    await runTick(client);
    assert.equal(calls.probes, 1);
    assert.deepEqual(calls.disconnect, []);
});

test('an unrelated 404 does not recycle the node', async () => {
    const { client, calls } = makeClient(async () => {
        throw restError(404, 'Player not found');
    });
    await runTick(client);
    assert.deepEqual(calls.disconnect, []);
});

test('server errors and missing sessions are not treated as stale', async () => {
    const failing = makeClient(async () => {
        throw restError(500, 'Internal error');
    });
    await runTick(failing.client);
    assert.deepEqual(failing.calls.disconnect, []);

    const handshaking = makeClient(async () => [], { sessionId: null });
    await runTick(handshaking.client);
    assert.equal(handshaking.calls.probes, 0);
    assert.deepEqual(handshaking.calls.disconnect, []);
});
