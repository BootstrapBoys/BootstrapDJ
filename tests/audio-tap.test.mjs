import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import config from '../dist/config.js';
import { relayAudioTap, resolveAudioTapTarget } from '../dist/dashboard/audioTap.js';
import { createLocalDashboardHost } from '../dist/dashboard/localHost.js';
import { route } from '../dist/dashboard/server.js';
import { FULL_ACCESS } from '../dist/dashboard/shardApi.js';

function listen(server) {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

function close(server) {
    server.closeAllConnections?.();
    return new Promise(resolve => server.close(resolve));
}

function get(port, path, headers = {}) {
    return new Promise((resolve, reject) => {
        const request = http.get(
            { host: '127.0.0.1', port, path, headers, agent: false },
            response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () =>
                    resolve({ status: response.statusCode, body: Buffer.concat(chunks) })
                );
            }
        );
        request.on('error', reject);
    });
}

test('tap targets accept configured Lavalink endpoints and reject invalid ones', () => {
    const target = resolveAudioTapTarget({
        url: '127.0.0.1:443',
        auth: 'lavalink-secret',
        secure: false,
    });
    assert.ok(target);
    assert.equal(target.url.port, '443');
    assert.equal(target.password, 'lavalink-secret');
    assert.equal(
        resolveAudioTapTarget({
            url: 'https://lavalink.example.com:443',
            auth: 'secret',
            secure: true,
        })?.url.protocol,
        'https:'
    );

    assert.equal(resolveAudioTapTarget({ url: 'ftp://127.0.0.1:443', auth: 'secret' }), null);
    assert.equal(resolveAudioTapTarget({ url: '127.0.0.1:443', auth: '' }), null);
    assert.equal(resolveAudioTapTarget({ url: '', auth: 'secret' }), null);
    assert.equal(
        resolveAudioTapTarget({ url: 'http://user:secret@127.0.0.1:443', auth: 'secret' }),
        null
    );
});

test('relay streams tap bytes with raw Lavalink auth and preserves 200', async () => {
    let receivedAuth = '';
    let receivedTapHeader;
    let receivedPath = '';

    const tap = http.createServer((request, response) => {
        receivedAuth = request.headers.authorization ?? '';
        receivedTapHeader = request.headers['x-bootstrapdj-tap'];
        receivedPath = request.url ?? '';
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.write(Buffer.from([0x02, 0x00, 0x02, 0x7b, 0x7d]));
        response.end(Buffer.from([0x01]));
    });
    const tapPort = await listen(tap);

    const proxy = http.createServer((request, response) => {
        relayAudioTap(response, '123456789012345678', {
            url: new URL(`http://127.0.0.1:${tapPort}`),
            password: 'lavalink-secret',
        });
    });
    const proxyPort = await listen(proxy);

    try {
        const result = await get(proxyPort, '/api/audio?guildId=123456789012345678');

        assert.equal(result.status, 200);
        assert.deepEqual([...result.body], [0x02, 0x00, 0x02, 0x7b, 0x7d, 0x01]);
        assert.equal(receivedAuth, 'lavalink-secret');
        assert.equal(receivedTapHeader, undefined);
        assert.equal(receivedPath, '/v4/audiotap/123456789012345678');
    } finally {
        await close(proxy);
        await close(tap);
    }
});

test('relay maps an unsupported tap route to 501', async () => {
    const tap = http.createServer((request, response) => {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('no player');
    });
    const tapPort = await listen(tap);

    const proxy = http.createServer((request, response) => {
        relayAudioTap(response, '123456789012345678', {
            url: new URL(`http://127.0.0.1:${tapPort}`),
            password: 'lavalink-secret',
        });
    });
    const proxyPort = await listen(proxy);

    try {
        const result = await get(proxyPort, '/api/audio?guildId=123456789012345678');

        assert.equal(result.status, 501);
        assert.equal(result.body.toString('utf8'), 'no player');
    } finally {
        await close(proxy);
        await close(tap);
    }
});

test('relay returns 503 when the tap is unreachable', async () => {
    const proxy = http.createServer((request, response) => {
        relayAudioTap(response, '123456789012345678', {
            // Port 1 is not a valid listener; the request fails fast.
            url: new URL('http://127.0.0.1:1'),
            password: 'lavalink-secret',
        });
    });
    const proxyPort = await listen(proxy);

    try {
        const result = await get(proxyPort, '/api/audio?guildId=123456789012345678');
        assert.equal(result.status, 503);
    } finally {
        await close(proxy);
    }
});

test('relay preserves auth and rate-limit statuses', async () => {
    for (const status of [401, 403, 429]) {
        const tap = http.createServer((request, response) => {
            response.writeHead(status, { 'content-type': 'text/plain' });
            response.end(String(status));
        });
        const tapPort = await listen(tap);
        const proxy = http.createServer((request, response) => {
            relayAudioTap(response, '123456789012345678', {
                url: new URL(`http://127.0.0.1:${tapPort}`),
                password: 'lavalink-secret',
            });
        });
        const proxyPort = await listen(proxy);
        try {
            const result = await get(proxyPort, '/api/audio?guildId=123456789012345678');
            assert.equal(result.status, status);
        } finally {
            await close(proxy);
            await close(tap);
        }
    }
});

test('relay maps unsupported methods and routes to 501', async () => {
    for (const status of [405, 501]) {
        const tap = http.createServer((request, response) => {
            response.writeHead(status, { 'content-type': 'text/plain' });
            response.end(String(status));
        });
        const tapPort = await listen(tap);
        const proxy = http.createServer((request, response) => {
            relayAudioTap(response, '123456789012345678', {
                url: new URL(`http://127.0.0.1:${tapPort}`),
                password: 'lavalink-secret',
            });
        });
        const proxyPort = await listen(proxy);
        try {
            const result = await get(proxyPort, '/api/audio?guildId=123456789012345678');
            assert.equal(result.status, 501);
        } finally {
            await close(proxy);
            await close(tap);
        }
    }
});

const GUILD = '123456789012345678';
const TEST_NODE = {
    name: 'test',
    url: '127.0.0.1:443',
    auth: 'lavalink-secret',
    secure: false,
};

function makeDashboardClient({ node = TEST_NODE } = {}) {
    const dashboardConfig = {
        ...config,
        lavalink: node ? [{ ...node }] : [],
    };
    return {
        config: dashboardConfig,
        guilds: { cache: new Map([[GUILD, { id: GUILD, name: 'Guild' }]]) },
        queue: new Map([
            [
                GUILD,
                {
                    guildId: GUILD,
                    node: node ? { name: node.name } : undefined,
                    current: { info: { title: 'Track', author: 'Artist', length: 1000 } },
                    paused: false,
                    queue: [],
                    autoplay: false,
                    loop: 'off',
                    volume: 100,
                    filters: [],
                    filterValues: {},
                    player: {},
                },
            ],
        ]),
        logger: { warn: () => {}, error: () => {}, info: () => {} },
        dashboardLocalAccess: async () => ({ found: true, access: FULL_ACCESS }),
        dashboardLocalPlayer: () => ({
            found: true,
            player: {
                title: 'Track',
                author: 'Artist',
                duration: 1000,
                position: 0,
                queueLength: 0,
                upcoming: [],
                volume: 100,
                paused: false,
                loop: 'off',
                autoplay: false,
                activeFilters: [],
                filterValues: {},
            },
        }),
        db: {
            getGuildSettings: async () => ({}),
            getAutoplaySetting: async () => null,
        },
    };
}

function makeGet(path) {
    return {
        method: 'GET',
        url: path,
        headers: { 'x-dashboard-token': 'test-token' },
        socket: { remoteAddress: '127.0.0.1' },
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
        setHeader: () => {},
        getHeader: () => undefined,
        end: chunk => {
            state.body = chunk ? String(chunk) : '';
        },
    };
}

async function callRoute(path, client = makeDashboardClient()) {
    const response = makeResponse();
    const saved = {
        token: config.dashboardToken,
        clientId: config.dashboardOAuthClientId,
        clientSecret: config.dashboardOAuthClientSecret,
        redirectUri: config.dashboardOAuthRedirectUri,
        sessionSecret: config.dashboardSessionSecret,
        envClientId: process.env.DASHBOARD_OAUTH_CLIENT_ID,
    };
    config.dashboardToken = 'test-token';
    config.dashboardOAuthClientId = '';
    config.dashboardOAuthClientSecret = '';
    config.dashboardOAuthRedirectUri = '';
    config.dashboardSessionSecret = '';
    delete process.env.DASHBOARD_OAUTH_CLIENT_ID;
    try {
        await route(createLocalDashboardHost(client), makeGet(path), response);
    } finally {
        config.dashboardToken = saved.token;
        config.dashboardOAuthClientId = saved.clientId;
        config.dashboardOAuthClientSecret = saved.clientSecret;
        config.dashboardOAuthRedirectUri = saved.redirectUri;
        config.dashboardSessionSecret = saved.sessionSecret;
        if (saved.envClientId === undefined) delete process.env.DASHBOARD_OAUTH_CLIENT_ID;
        else process.env.DASHBOARD_OAUTH_CLIENT_ID = saved.envClientId;
    }
    return response.state;
}

test('state advertises audio and permission for a configured node', async () => {
    const state = await callRoute(`/api/state?guildId=${GUILD}`);
    assert.equal(state.status, 200);
    const payload = JSON.parse(state.body);
    assert.equal(payload.audio.available, true);
    assert.equal(payload.audio.canListen, true);
});

test('state disables audio when the active node is not configured', async () => {
    const state = await callRoute(
        `/api/state?guildId=${GUILD}`,
        makeDashboardClient({ node: null })
    );
    assert.equal(state.status, 200);
    assert.equal(JSON.parse(state.body).audio.available, false);
});

test('state reports canListen false and audio route returns 403 for denied roles', async () => {
    const deniedGuild = '323456789012345678';
    const denied = makeDashboardClient();
    denied.dashboardLocalAccess = async () => ({
        found: true,
        access: { ...FULL_ACCESS, listen: false },
    });
    const state = await callRoute(`/api/state?guildId=${deniedGuild}`, denied);
    assert.equal(state.status, 200);
    assert.equal(JSON.parse(state.body).audio.canListen, false);

    const audio = await callRoute(`/api/audio?guildId=${deniedGuild}`, denied);
    assert.equal(audio.status, 403);
});

test('audio route returns 503 when the active node has no target', async () => {
    const state = await callRoute(
        `/api/audio?guildId=${GUILD}`,
        makeDashboardClient({ node: null })
    );
    assert.equal(state.status, 503);
});
