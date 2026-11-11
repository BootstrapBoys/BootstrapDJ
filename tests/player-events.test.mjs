import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlayerEventHub } from '../dist/dashboard/events.js';
import { PlayerStateCache } from '../dist/dashboard/playerCache.js';

const player = {
    title: 'Track',
    author: 'Artist',
    duration: 120_000,
    position: 1_000,
    queueLength: 0,
    upcoming: [],
    volume: 100,
    paused: false,
    loop: 'off',
    autoplay: false,
    activeFilters: [],
    filterValues: {},
};

function fakeResponse() {
    const chunks = [];
    let close = null;
    const res = {
        writableEnded: false,
        status: 0,
        headers: {},
        chunks,
        writeHead(status, headers) {
            res.status = status;
            res.headers = headers;
        },
        write(chunk) {
            chunks.push(String(chunk));
            return true;
        },
        end() {
            res.writableEnded = true;
            close?.();
        },
        once(event, callback) {
            if (event === 'close') close = callback;
        },
        on() {},
        close() {
            res.writableEnded = true;
            close?.();
        },
    };
    return res;
}

function hostWithCounter() {
    const host = {
        calls: 0,
        player: async () => {
            host.calls += 1;
            return { found: true, player };
        },
    };
    return host;
}

test('SSE clients in one guild share the cached snapshot', async () => {
    const host = hostWithCounter();
    const cache = new PlayerStateCache({ refreshMs: 50, staleMaxMs: 1_000 });
    const hub = new PlayerEventHub(cache, { updateMs: 10, heartbeatMs: 1_000 });
    const first = fakeResponse();
    const second = fakeResponse();

    hub.attach(host, 'guild', 'user-1', first);
    await new Promise(resolve => setTimeout(resolve, 5));
    hub.attach(host, 'guild', 'user-2', second);
    await new Promise(resolve => setTimeout(resolve, 5));

    assert.equal(host.calls, 1);
    assert.equal(first.status, 200);
    assert.match(first.headers['content-type'], /text\/event-stream/);
    assert.ok(first.chunks.some(chunk => chunk.startsWith('data: ')));
    assert.ok(second.chunks.some(chunk => chunk.startsWith('data: ')));

    first.close();
    second.close();
});

test('the hub updates once per interval, not once per client', async () => {
    const host = hostWithCounter();
    const cache = new PlayerStateCache({ refreshMs: 1, staleMaxMs: 1_000 });
    const hub = new PlayerEventHub(cache, { updateMs: 15, heartbeatMs: 1_000 });
    const clients = [fakeResponse(), fakeResponse(), fakeResponse()];
    for (let index = 0; index < clients.length; index += 1) {
        hub.attach(host, 'guild', `user-${index}`, clients[index]);
    }

    await new Promise(resolve => setTimeout(resolve, 40));
    assert.ok(host.calls <= 4, `upstream calls stayed bounded: ${host.calls}`);

    for (const client of clients) client.close();
});

test('logout closes only that user’s SSE streams', async () => {
    const host = hostWithCounter();
    const cache = new PlayerStateCache({ refreshMs: 50, staleMaxMs: 1_000 });
    const hub = new PlayerEventHub(cache, { updateMs: 50, heartbeatMs: 1_000 });
    const first = fakeResponse();
    const second = fakeResponse();
    hub.attach(host, 'guild', 'user-a', first);
    hub.attach(host, 'guild', 'user-b', second);

    hub.disconnectUser('user-a');
    assert.equal(first.writableEnded, true);
    assert.equal(second.writableEnded, false);
    for (const client of [first, second]) client.close();
});

test('expired session streams close themselves', async () => {
    const host = hostWithCounter();
    const cache = new PlayerStateCache({ refreshMs: 50, staleMaxMs: 1_000 });
    const hub = new PlayerEventHub(cache, { updateMs: 10, heartbeatMs: 10 });
    const client = fakeResponse();
    hub.attach(host, 'guild', 'short-session', client, Date.now() + 20);

    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(client.writableEnded, true);
    client.close();
});
