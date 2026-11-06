import assert from 'node:assert/strict';
import test from 'node:test';

import { Utils } from '../dist/utils/Utils.js';

test('livestreams report LIVE instead of dividing by zero', () => {
    assert.equal(Utils.progressBar(0, 0), '🔴 LIVE');
    assert.equal(Utils.progressBar(30, Number.POSITIVE_INFINITY), '🔴 LIVE');
    assert.equal(Utils.progressBar(30, -1), '🔴 LIVE');
});

test('bar fills proportionally', () => {
    const bar = Utils.progressBar(30, 60, 10);
    assert.equal(bar, `${'▓'.repeat(5)}${'░'.repeat(5)} 50%`);
});

test('position past the end is clamped to 100%', () => {
    const bar = Utils.progressBar(120, 60, 10);
    assert.equal(bar, `${'▓'.repeat(10)} 100%`);
});

test('formatTime renders seconds, minutes and hours', () => {
    assert.equal(Utils.formatTime(0), '0s');
    assert.equal(Utils.formatTime(1000), '1s');
    assert.equal(Utils.formatTime(9_620), '9s');
    assert.equal(Utils.formatTime(65_000), '1m 5s');
    assert.equal(Utils.formatTime(3_725_000), '1h 2m');
    assert.equal(Utils.formatTime(90_000_000), '1d 1h');
});
