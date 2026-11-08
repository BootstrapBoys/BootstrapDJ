import assert from 'node:assert/strict';
import test from 'node:test';

import { GuildAccessCache } from '../dist/dashboard/accessCache.js';
import {
    RATE_BUCKET_MAX,
    clientAddress,
    rateBucketCount,
    rateLimited,
} from '../dist/dashboard/auth.js';

function makeRequest(remoteAddress, headers = {}) {
    return { headers, socket: { remoteAddress } };
}

const ACCESS = {
    member: true,
    owner: false,
    admin: true,
    controls: true,
    settings: true,
};

test('guild access cache copies values and expires on its TTL', () => {
    let now = 1_000;
    const cache = new GuildAccessCache(60_000, 10, () => now);

    cache.set('session:g1', ACCESS);
    const first = cache.get('session:g1');
    assert.deepEqual(first, ACCESS);

    first.controls = false;
    assert.equal(cache.get('session:g1').controls, true, 'a caller must not mutate the cache');

    now += 59_999;
    assert.notEqual(cache.get('session:g1'), null);
    now += 1;
    assert.equal(cache.get('session:g1'), null, 'the entry must expire at the TTL');
});

test('invalidating one guild leaves other guilds cached', () => {
    const cache = new GuildAccessCache(60_000, 10);
    cache.set('s1:g1', ACCESS);
    cache.set('s2:g1', ACCESS);
    cache.set('s1:g2', ACCESS);
    cache.set('token:g1', ACCESS);

    cache.invalidateGuild('g1');

    assert.equal(cache.size, 1);
    assert.equal(cache.get('s1:g2').member, true);
});

test('the access cache is bounded', () => {
    const cache = new GuildAccessCache(60_000, 2);
    cache.set('a', ACCESS);
    cache.set('b', ACCESS);
    cache.set('c', ACCESS);

    assert.equal(cache.size, 2);
    assert.equal(cache.get('a'), null, 'the oldest entry is evicted');
    assert.notEqual(cache.get('c'), null);
});

test('X-Forwarded-For is ignored from a non-loopback peer', () => {
    const request = makeRequest('203.0.113.5', { 'x-forwarded-for': '198.51.100.7' });
    assert.equal(clientAddress(request), '203.0.113.5');
});

test('a loopback proxy may forward the last hop only', () => {
    const request = makeRequest('127.0.0.1', {
        // The first entry is caller-controlled; the proxy appends the real peer.
        'x-forwarded-for': '1.1.1.1, 198.51.100.7',
    });
    assert.equal(clientAddress(request), '198.51.100.7');

    const bracketed = makeRequest('::1', {
        'x-forwarded-for': '[2001:db8::1]:443',
    });
    assert.equal(clientAddress(bracketed), '2001:db8::1');

    const withPort = makeRequest('127.0.0.1', { 'x-forwarded-for': '198.51.100.9:1234' });
    assert.equal(clientAddress(withPort), '198.51.100.9');
});

test('malformed forwarding headers fall back to the socket peer', () => {
    const request = makeRequest('127.0.0.1', { 'x-forwarded-for': 'not-an-ip' });
    assert.equal(clientAddress(request), '127.0.0.1');
});

test('rate limiting keeps separate buckets per verified client', () => {
    const first = makeRequest('127.0.0.1', { 'x-forwarded-for': '198.51.100.1' });
    const second = makeRequest('127.0.0.1', { 'x-forwarded-for': '198.51.100.2' });

    assert.equal(rateLimited(first, 'test-separate', 2, 60_000), false);
    assert.equal(rateLimited(first, 'test-separate', 2, 60_000), false);
    assert.equal(rateLimited(first, 'test-separate', 2, 60_000), true);
    assert.equal(rateLimited(second, 'test-separate', 2, 60_000), false);
});

test('a spoofed forwarding header cannot mint fresh buckets', () => {
    const limit = 1;
    for (let index = 0; index < 3; index++) {
        const request = makeRequest('203.0.113.9', {
            'x-forwarded-for': `198.51.100.${index + 1}`,
        });
        const limited = rateLimited(request, 'test-spoof', limit, 60_000);
        assert.equal(limited, index >= limit, `request ${index} must share the socket bucket`);
    }
});

test('the rate-limit bucket map stays under its hard ceiling', () => {
    const start = rateBucketCount();
    for (let index = 0; index <= RATE_BUCKET_MAX + 10; index++) {
        const request = makeRequest('127.0.0.1', {
            'x-forwarded-for': `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`,
        });
        rateLimited(request, 'test-cap', 100, 60_000);
    }
    assert.ok(rateBucketCount() <= RATE_BUCKET_MAX);
    assert.ok(rateBucketCount() >= start);
});
