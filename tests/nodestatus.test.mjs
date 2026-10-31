import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    describeCloseCode,
    formatNodeError,
    isQuietWindow,
    noteDestroy,
    openQuietWindow,
    resetDestroyCount,
} from '../dist/utils/NodeStatus.js';

test('a 1001 close reads as a restart, not a crash', () => {
    const info = describeCloseCode(1001);

    assert.equal(info.expected, true);
    assert.match(info.summary, /restarting|shutting down/);
});

test('abnormal closes are reported as unexpected', () => {
    for (const code of [1005, 1006, 1011, 4321]) {
        assert.equal(describeCloseCode(code).expected, false, `code ${code}`);
    }
    assert.equal(describeCloseCode(1006).expected, false);
    assert.match(describeCloseCode(1006).summary, /close frame/);
});

test('formatNodeError copes with the empty object Shoukaku often sends', () => {
    assert.equal(formatNodeError({}), 'no details from the server');
    assert.equal(formatNodeError(null), 'no details from the server');
    assert.equal(formatNodeError(new Error('boom')), 'boom');
    assert.equal(formatNodeError({ message: 'bad gateway', code: 502 }), 'bad gateway, code 502');
    assert.equal(formatNodeError('plain text'), 'plain text');
});

test('the disconnect counter only trips at five and resets', () => {
    resetDestroyCount();
    for (let i = 1; i <= 4; i++) assert.equal(noteDestroy(), i);
    assert.equal(noteDestroy(), 5);
    resetDestroyCount();
    assert.equal(noteDestroy(), 1);
    resetDestroyCount();
});

test('an expected close opens and closes the quiet window', () => {
    openQuietWindow(0);
    assert.equal(isQuietWindow(), false);

    openQuietWindow(60);
    assert.equal(isQuietWindow(), true);

    openQuietWindow(0);
    assert.equal(isQuietWindow(), false);
});
