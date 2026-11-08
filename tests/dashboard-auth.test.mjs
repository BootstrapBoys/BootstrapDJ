import assert from 'node:assert/strict';
import test from 'node:test';

import config from '../dist/config.js';
import {
    anonymousAccessAllowed,
    authorized,
    isLoopbackHost,
    viewer,
} from '../dist/dashboard/auth.js';

function makeRequest(headers = {}) {
    return { headers, socket: { remoteAddress: '127.0.0.1' } };
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

test('the default dashboard configuration refuses anonymous owner access', () => {
    assert.equal(config.dashboardToken, '');
    assert.equal(config.dashboardAllowAnonymous, false);

    assert.equal(authorized(makeRequest()), false);
    const identity = viewer(makeRequest());
    assert.equal(identity.owner, false);
    assert.equal(identity.admin, false);
    assert.match(identity.name, /Unauthenticated/);
});

test('an explicit anonymous loopback opt-in restores local owner access', () => {
    const original = config.dashboardAllowAnonymous;
    config.dashboardAllowAnonymous = true;
    try {
        assert.equal(authorized(makeRequest()), true);
        assert.equal(viewer(makeRequest()).owner, true);
    } finally {
        config.dashboardAllowAnonymous = original;
    }
});

test('a public URL refuses anonymous access even with the flag set', () => {
    const original = { allow: config.dashboardAllowAnonymous, url: config.dashboardPublicUrl };
    config.dashboardAllowAnonymous = true;
    config.dashboardPublicUrl = 'https://dj.example.org';
    try {
        assert.equal(authorized(makeRequest()), false);
        assert.equal(viewer(makeRequest()).owner, false);
    } finally {
        config.dashboardAllowAnonymous = original.allow;
        config.dashboardPublicUrl = original.url;
    }
});

test('token mode still authenticates its header and bearer forms', () => {
    const original = config.dashboardToken;
    config.dashboardToken = 'secret-token';
    try {
        assert.equal(authorized(makeRequest()), false);
        assert.equal(authorized(makeRequest({ 'x-dashboard-token': 'secret-token' })), true);
        assert.equal(authorized(makeRequest({ authorization: 'Bearer secret-token' })), true);
        assert.equal(authorized(makeRequest({ 'x-dashboard-token': 'wrong' })), false);
        assert.equal(viewer(makeRequest()).owner, true);
    } finally {
        config.dashboardToken = original;
    }
});
