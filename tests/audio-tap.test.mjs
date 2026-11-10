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

test('tap targets are accepted only on loopback http(s)', () => {
    const target = resolveAudioTapTarget('http://127.0.0.1:2444', 'secret');
    assert.ok(target);
    assert.equal(target.url.port, '2444');

    assert.equal(resolveAudioTapTarget('http://example.com:2444', 'secret'), null);
    assert.equal(resolveAudioTapTarget('http://192.168.1.235:2444', 'secret'), null);
    assert.equal(resolveAudioTapTarget('ftp://127.0.0.1:2444', 'secret'), null);
    assert.equal(resolveAudioTapTarget('http://127.0.0.1:2444', ''), null);
    assert.equal(resolveAudioTapTarget('', 'secret'), null);
    assert.equal(resolveAudioTapTarget('not a url', 'secret'), null);
});

test('relay streams tap bytes with the tap token and preserves 200', async () => {
    let receivedAuth = '';
    let receivedPath = '';

    const tap = http.createServer((request, response) => {
        receivedAuth = request.headers.authorization ?? '';
        receivedPath = request.url ?? '';
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.write(Buffer.from([0x02, 0x00, 0x02, 0x7b, 0x7d]));
        response.end(Buffer.from([0x01]));
    });
    const tapPort = await listen(tap);

    const proxy = http.createServer((request, response) => {
        relayAudioTap(response, '123456789012345678', {
            url: new URL(`http://127.0.0.1:${tapPort}`),
            token: 'tap-secret',
        });
    });
    const proxyPort = await listen(proxy);

    try {
        const result = await get(proxyPort, '/api/audio?guildId=123456789012345678');

        assert.equal(result.status, 200);
        assert.deepEqual([...result.body], [0x02, 0x00, 0x02, 0x7b, 0x7d, 0x01]);
        assert.equal(receivedAuth, 'tap-secret');
        assert.equal(receivedPath, '/tap/123456789012345678');
    } finally {
        await close(proxy);
        await close(tap);
    }
});

test('relay preserves the tap status for an unknown guild', async () => {
    const tap = http.createServer((request, response) => {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('no player');
    });
    const tapPort = await listen(tap);

    const proxy = http.createServer((request, response) => {
        relayAudioTap(response, '123456789012345678', {
            url: new URL(`http://127.0.0.1:${tapPort}`),
            token: 'tap-secret',
        });
    });
    const proxyPort = await listen(proxy);

    try {
        const result = await get(proxyPort, '/api/audio?guildId=123456789012345678');

        assert.equal(result.status, 404);
        assert.equal(result.body.toString('utf8'), 'no player');
    } finally {
        await close(proxy);
        await close(tap);
    }
});

test('relay returns 502 when the tap is unreachable', async () => {
    const proxy = http.createServer((request, response) => {
        relayAudioTap(response, '123456789012345678', {
            // Port 1 is not a valid listener; the request fails fast.
            url: new URL('http://127.0.0.1:1'),
            token: 'tap-secret',
        });
    });
    const proxyPort = await listen(proxy);

    try {
        const result = await get(proxyPort, '/api/audio?guildId=123456789012345678');
        assert.equal(result.status, 502);
    } finally {
        await close(proxy);
    }
});

const GUILD = '123456789012345678';

function makeDashboardClient() {
    return {
        config,
        guilds: { cache: new Map([[GUILD, { id: GUILD, name: 'Guild' }]]) },
        queue: new Map([
            [
                GUILD,
                {
                    guildId: GUILD,
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

async function withTapConfig(url, token, run) {
    const savedUrl = config.dashboardTapUrl;
    const savedToken = config.dashboardTapToken;
    const savedOAuth = {
        clientId: config.dashboardOAuthClientId,
        clientSecret: config.dashboardOAuthClientSecret,
        redirectUri: config.dashboardOAuthRedirectUri,
        sessionSecret: config.dashboardSessionSecret,
    };
    const savedEnv = process.env.DASHBOARD_OAUTH_CLIENT_ID;
    config.dashboardTapUrl = url;
    config.dashboardTapToken = token;
    config.dashboardToken = 'test-token';
    config.dashboardOAuthClientId = '';
    config.dashboardOAuthClientSecret = '';
    config.dashboardOAuthRedirectUri = '';
    config.dashboardSessionSecret = '';
    delete process.env.DASHBOARD_OAUTH_CLIENT_ID;
    try {
        await run();
    } finally {
        config.dashboardTapUrl = savedUrl;
        config.dashboardTapToken = savedToken;
        config.dashboardToken = 'test-token';
        Object.assign(config, {
            dashboardOAuthClientId: savedOAuth.clientId,
            dashboardOAuthClientSecret: savedOAuth.clientSecret,
            dashboardOAuthRedirectUri: savedOAuth.redirectUri,
            dashboardSessionSecret: savedOAuth.sessionSecret,
        });
        if (savedEnv === undefined) delete process.env.DASHBOARD_OAUTH_CLIENT_ID;
        else process.env.DASHBOARD_OAUTH_CLIENT_ID = savedEnv;
    }
}

async function callRoute(path) {
    const response = makeResponse();
    await route(createLocalDashboardHost(makeDashboardClient()), makeGet(path), response);
    return response.state;
}

test('state advertises audio only when both tap settings exist', async () => {
    await withTapConfig('http://127.0.0.1:2444', 'tap-secret', async () => {
        const state = await callRoute(`/api/state?guildId=${GUILD}`);
        assert.equal(state.status, 200);
        assert.equal(JSON.parse(state.body).audio.available, true);
    });

    await withTapConfig('', '', async () => {
        const state = await callRoute(`/api/state?guildId=${GUILD}`);
        assert.equal(state.status, 200);
        assert.equal(JSON.parse(state.body).audio.available, false);
    });

    await withTapConfig('http://example.com:2444', 'tap-secret', async () => {
        const state = await callRoute(`/api/state?guildId=${GUILD}`);
        assert.equal(state.status, 200);
        assert.equal(JSON.parse(state.body).audio.available, false);
    });
});

test('audio route returns 503 when the tap is not configured', async () => {
    await withTapConfig('', '', async () => {
        const state = await callRoute(`/api/audio?guildId=${GUILD}`);
        assert.equal(state.status, 503);
    });
});
