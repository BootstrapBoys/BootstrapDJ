import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startAccessLease } from '../dist/dashboard/accessLease.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('access leases close only after an explicit revocation', async () => {
    let checks = 0;
    let revoked = 0;
    const timer = startAccessLease(
        async () => {
            checks += 1;
            return false;
        },
        () => {
            revoked += 1;
        },
        10
    );
    await sleep(35);
    clearInterval(timer);
    assert.ok(checks >= 1);
    assert.equal(revoked, 1);
});

test('transient access errors do not revoke a stream', async () => {
    let checks = 0;
    let revoked = 0;
    const timer = startAccessLease(
        async () => {
            checks += 1;
            throw new Error('control unavailable');
        },
        () => {
            revoked += 1;
        },
        10
    );
    await sleep(35);
    clearInterval(timer);
    assert.ok(checks >= 1);
    assert.equal(revoked, 0);
});
