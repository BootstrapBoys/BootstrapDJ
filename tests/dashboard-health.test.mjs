import assert from 'node:assert/strict';
import test from 'node:test';

import { collectHealth } from '../dist/dashboard/health.js';
import { route } from '../dist/dashboard/server.js';

function fakeClient(overrides = {}) {
    return {
        isReady: () => true,
        guilds: {
            cache: new Map([
                ['g1', {}],
                ['g2', {}],
            ]),
        },
        queue: new Map([['g1', {}]]),
        shoukaku: {
            nodes: new Map([
                ['main', { state: 1 }],
                ['backup', { state: 3 }],
            ]),
        },
        db: { ping: async () => true },
        ...overrides,
    };
}

function makeResponse() {
    const state = { status: 0, body: '' };
    return {
        headersSent: false,
        state,
        writeHead: code => {
            state.status = code;
        },
        end: chunk => {
            state.body = chunk ? String(chunk) : '';
        },
        getHeader: () => undefined,
        setHeader: () => {},
    };
}

async function get(path, host) {
    const req = {
        method: 'GET',
        url: path,
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
    };
    const res = makeResponse();
    await route(host, req, res);
    return res.state;
}

test('collectHealth requires the gateway, a Lavalink node and the database', async () => {
    const health = await collectHealth(fakeClient());

    assert.equal(health.ok, true);
    assert.equal(health.status, 'ok');
    assert.equal(health.botReady, true);
    assert.equal(health.database, true);
    assert.equal(health.guilds, 2);
    assert.equal(health.players, 1);
    assert.deepEqual(health.nodes, { connected: 1, total: 2 });
    assert.ok(health.uptimeSec >= 0);
    assert.match(health.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('collectHealth degrades on a missing node, database failure or logged-out client', async () => {
    const noNode = await collectHealth(
        fakeClient({ shoukaku: { nodes: new Map([['main', { state: 3 }]]) } })
    );
    assert.equal(noNode.ok, false);
    assert.equal(noNode.status, 'degraded');
    assert.deepEqual(noNode.nodes, { connected: 0, total: 1 });

    const noDatabase = await collectHealth(fakeClient({ db: { ping: async () => false } }));
    assert.equal(noDatabase.ok, false);
    assert.equal(noDatabase.database, false);

    const loggedOut = await collectHealth(fakeClient({ isReady: () => false }));
    assert.equal(loggedOut.ok, false);
    assert.equal(loggedOut.botReady, false);
});

test('/health is public and returns 200 when ready', async () => {
    const health = await collectHealth(fakeClient());
    const result = await get('/health', { health: async () => health });

    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), health);
});

test('/health returns 503 when degraded or the control API is unavailable', async () => {
    const degraded = await get('/health', {
        health: async () => ({
            ok: false,
            status: 'degraded',
            botReady: true,
            database: true,
            uptimeSec: 1,
            guilds: 0,
            players: 0,
            nodes: { connected: 0, total: 0 },
            checkedAt: new Date().toISOString(),
        }),
    });
    assert.equal(degraded.status, 503);
    assert.equal(JSON.parse(degraded.body).status, 'degraded');

    const unavailable = await get('/health', {
        health: async () => {
            throw new Error('control down');
        },
    });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(JSON.parse(unavailable.body), {
        ok: false,
        status: 'degraded',
        error: 'control unavailable',
    });
});
