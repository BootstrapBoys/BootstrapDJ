import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import config from '../dist/config.js';
import { route } from '../dist/dashboard/server.js';
import {
    FULL_ACCESS,
    dashboardFilter,
    dashboardPlayerAction,
} from '../dist/dashboard/shardApi.js';

const CSRF = 'abcdefghijklmnopqrstuvwxyz0123456789';

function makeRequest(body) {
    const stream = Readable.from([JSON.stringify(body)]);
    return Object.assign(stream, {
        method: 'POST',
        url: '/',
        headers: {
            'content-type': 'application/json',
            'x-dashboard-token': 'test-token',
            'x-dashboard-csrf': CSRF,
            cookie: `bdj_csrf=${CSRF}`,
        },
        socket: { remoteAddress: '127.0.0.1' },
    });
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

function makeClient(queue = new Map()) {
    const client = {
        guilds: { cache: new Map([['g1', { id: 'g1', name: 'Guild' }]]) },
        queue,
        logger: { warn: () => {}, error: () => {}, info: () => {} },
        dashboardLocalAccess: async () => ({ found: true, access: FULL_ACCESS }),
        db: {},
    };
    client.dashboardLocalPlayerAction = (guildId, action, value) =>
        dashboardPlayerAction(client, guildId, action, value);
    client.dashboardLocalFilter = (guildId, id, enabled, value) =>
        dashboardFilter(client, guildId, id, enabled, value);
    return client;
}

async function withDashboardConfig(run) {
    const saved = {};
    for (const key of [
        'dashboardToken',
        'dashboardOAuthClientId',
        'dashboardOAuthClientSecret',
        'dashboardOAuthRedirectUri',
        'dashboardSessionSecret',
    ]) {
        saved[key] = config[key];
    }
    const savedEnv = process.env.DASHBOARD_OAUTH_CLIENT_ID;
    config.dashboardToken = 'test-token';
    config.dashboardOAuthClientId = '';
    config.dashboardOAuthClientSecret = '';
    config.dashboardOAuthRedirectUri = '';
    config.dashboardSessionSecret = '';
    delete process.env.DASHBOARD_OAUTH_CLIENT_ID;
    try {
        await run();
    } finally {
        for (const [key, value] of Object.entries(saved)) config[key] = value;
        if (savedEnv === undefined) delete process.env.DASHBOARD_OAUTH_CLIENT_ID;
        else process.env.DASHBOARD_OAUTH_CLIENT_ID = savedEnv;
    }
}

async function post(path, body, client) {
    let status = 0;
    let payload = '';
    await withDashboardConfig(async () => {
        const req = makeRequest(body);
        req.url = path;
        const res = makeResponse();
        await route(client, req, res);
        status = res.state.status;
        payload = res.state.body;
    });
    return { status, body: payload };
}

test('unknown settings, filters, actions and missing players return 4xx', async () => {
    const unknownSetting = await post(
        '/api/settings',
        { guildId: 'g1', key: 'notasetting', value: '1' },
        makeClient()
    );
    assert.equal(unknownSetting.status, 400);

    const unknownFilter = await post(
        '/api/filter',
        { guildId: 'g1', filter: 'not-a-filter', enabled: true },
        makeClient(
            new Map([
                ['g1', { filters: [], filterValues: {}, player: {} }],
            ])
        )
    );
    assert.equal(unknownFilter.status, 400);

    const missingFilterPlayer = await post(
        '/api/filter',
        { guildId: 'g1', filter: 'bassboost', enabled: true },
        makeClient()
    );
    assert.equal(missingFilterPlayer.status, 404);

    const missingActionPlayer = await post(
        '/api/player',
        { guildId: 'g1', action: 'toggle' },
        makeClient()
    );
    assert.equal(missingActionPlayer.status, 404);

    const unknownAction = await post(
        '/api/player',
        { guildId: 'g1', action: 'launch-missiles' },
        makeClient(new Map([['g1', {}]]))
    );
    assert.equal(unknownAction.status, 400);
});
