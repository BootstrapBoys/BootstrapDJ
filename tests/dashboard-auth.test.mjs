import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import dotenv from 'dotenv';

import config from '../dist/config.js';
import {
    anonymousAccessAllowed,
    authorized,
    createSession,
    csrfMatches,
    isLoopbackHost,
    readSession,
    revokeSession,
    viewer,
} from '../dist/dashboard/auth.js';

function makeRequest(headers = {}) {
    return { headers, socket: { remoteAddress: '127.0.0.1' } };
}

/** Pin the auth-related config for one case, then restore it. */
async function withConfig(patch, run) {
    const saved = {};
    const savedEnv = process.env.DASHBOARD_OAUTH_CLIENT_ID;
    for (const [key, value] of Object.entries(patch)) {
        saved[key] = config[key];
        config[key] = value;
    }
    delete process.env.DASHBOARD_OAUTH_CLIENT_ID;
    try {
        await run();
    } finally {
        for (const [key, value] of Object.entries(saved)) config[key] = value;
        if (savedEnv === undefined) delete process.env.DASHBOARD_OAUTH_CLIENT_ID;
        else process.env.DASHBOARD_OAUTH_CLIENT_ID = savedEnv;
    }
}

function noAuthConfig(patch = {}) {
    return {
        dashboardToken: '',
        dashboardAllowAnonymous: false,
        dashboardPublicUrl: '',
        dashboardOAuthClientSecret: '',
        dashboardOAuthRedirectUri: '',
        dashboardSessionSecret: '',
        ...patch,
    };
}

test('loopback detection covers the accepted spellings only', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', ' LOCALHOST ']) {
        assert.equal(isLoopbackHost(host), true, host);
    }
    for (const host of ['0.0.0.0', '192.168.1.10', 'dashboard.example.com', '']) {
        assert.equal(isLoopbackHost(host), false, host);
    }
});

test('anonymous access is opt-in and voided by a public URL', () => {
    const base = { allowAnonymous: true, publicUrl: '', host: '127.0.0.1' };

    assert.equal(anonymousAccessAllowed(base), true);
    assert.equal(anonymousAccessAllowed({ ...base, allowAnonymous: false }), false);
    assert.equal(anonymousAccessAllowed({ ...base, host: '0.0.0.0' }), false);
    assert.equal(
        anonymousAccessAllowed({ ...base, publicUrl: 'https://dj.example.org' }),
        false,
        'a proxied port must not trust a loopback bind'
    );
    assert.equal(anonymousAccessAllowed({ ...base, publicUrl: '   ' }), true);
});

test('a dashboard with no token or anonymous opt-in refuses access', async () => {
    await withConfig(noAuthConfig(), () => {
        assert.equal(authorized(makeRequest()), false);
        const identity = viewer(makeRequest());
        assert.equal(identity.owner, false);
        assert.equal(identity.admin, false);
        assert.match(identity.name, /Unauthenticated/);
    });
});

test('an explicit anonymous loopback opt-in restores local owner access', async () => {
    await withConfig(noAuthConfig({ dashboardAllowAnonymous: true }), () => {
        assert.equal(authorized(makeRequest()), true);
        assert.equal(viewer(makeRequest()).owner, true);
    });
});

test('a public URL refuses anonymous access even with the flag set', async () => {
    await withConfig(
        noAuthConfig({
            dashboardAllowAnonymous: true,
            dashboardPublicUrl: 'https://dj.example.org',
        }),
        () => {
            assert.equal(authorized(makeRequest()), false);
            assert.equal(viewer(makeRequest()).owner, false);
        }
    );
});

test('token mode still authenticates its header and bearer forms', async () => {
    await withConfig(noAuthConfig({ dashboardToken: 'secret-token' }), () => {
        assert.equal(authorized(makeRequest()), false);
        assert.equal(authorized(makeRequest({ 'x-dashboard-token': 'secret-token' })), true);
        assert.equal(authorized(makeRequest({ authorization: 'Bearer secret-token' })), true);
        assert.equal(authorized(makeRequest({ 'x-dashboard-token': 'wrong' })), false);
        assert.equal(viewer(makeRequest()).owner, true);
    });
});

test('.env.example leaves dashboard OAuth blank so token mode is not locked out', () => {
    const parsed = dotenv.parse(fs.readFileSync(new URL('../.env.example', import.meta.url)));

    for (const key of [
        'DASHBOARD_OAUTH_CLIENT_ID',
        'DASHBOARD_OAUTH_CLIENT_SECRET',
        'DASHBOARD_OAUTH_REDIRECT_URI',
        'DASHBOARD_SESSION_SECRET',
    ]) {
        assert.equal(parsed[key], '', `${key} must stay blank in the example`);
    }
    assert.equal(parsed.DASHBOARD_TOKEN, '');
});

test('a session cookie is signed, expiring and revocable', async () => {
    await withConfig(noAuthConfig({ dashboardSessionSecret: 'test-session-secret' }), () => {
        const token = createSession({ id: 'user-1', username: 'tester', avatar: null });
        const request = extra => ({
            ...makeRequest(),
            headers: { cookie: `bdj_session=${encodeURIComponent(token)}`, ...extra },
        });

        const session = readSession(request());
        assert.equal(session.id, 'user-1');
        assert.equal(session.name, 'tester');

        const [payload, signature] = token.split('.');
        const tamperedPayload = `${payload[0] === 'A' ? 'B' : 'A'}${payload.slice(1)}.${signature}`;
        assert.equal(
            readSession({
                ...makeRequest(),
                headers: { cookie: `bdj_session=${encodeURIComponent(tamperedPayload)}` },
            }),
            null,
            'a modified payload must fail the HMAC check'
        );
        const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        assert.equal(
            readSession({
                ...makeRequest(),
                headers: {
                    cookie: `bdj_session=${encodeURIComponent(`${payload}.${tamperedSignature}`)}`,
                },
            }),
            null,
            'a modified signature must be rejected'
        );

        revokeSession(session);
        assert.equal(readSession(request()), null, 'logout must revoke the session in-process');

        const fresh = createSession({ id: 'user-1', username: 'tester', avatar: null });
        const realNow = Date.now;
        Date.now = () => realNow() + 25 * 60 * 60 * 1000;
        try {
            assert.equal(
                readSession({
                    ...makeRequest(),
                    headers: { cookie: `bdj_session=${encodeURIComponent(fresh)}` },
                }),
                null,
                'an expired session must not authenticate'
            );
        } finally {
            Date.now = realNow;
        }
    });
});

test('CSRF requires the cookie value in the request header', async () => {
    assert.equal(
        csrfMatches({ headers: { cookie: 'bdj_csrf=token-123', 'x-dashboard-csrf': 'token-123' } }),
        true
    );
    assert.equal(
        csrfMatches({ headers: { cookie: 'bdj_csrf=token-123', 'x-dashboard-csrf': 'other' } }),
        false
    );
    assert.equal(csrfMatches({ headers: { cookie: 'bdj_csrf=token-123' } }), false);
    assert.equal(csrfMatches({ headers: { 'x-dashboard-csrf': 'token-123' } }), false);
});

test('OAuth mode accepts a signed session and rejects an anonymous request', async () => {
    await withConfig(
        noAuthConfig({
            dashboardOAuthClientId: 'client-id',
            dashboardOAuthClientSecret: 'client-secret',
            dashboardOAuthRedirectUri: 'https://dashboard.example.com/auth/callback',
            dashboardSessionSecret: 'test-session-secret',
        }),
        () => {
            assert.equal(authorized(makeRequest()), false);
            const token = createSession({ id: 'user-1', username: 'tester', avatar: null });
            assert.equal(
                authorized({
                    ...makeRequest(),
                    headers: { cookie: `bdj_session=${encodeURIComponent(token)}` },
                }),
                true
            );
        }
    );
});
