import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    beginIncident,
    describeCloseCode,
    endIncident,
    formatDuration,
    formatNodeError,
    isIncidentActive,
    resetNodeStatus,
    takeReminder,
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
    assert.match(describeCloseCode(1006).summary, /close frame/);
});

test('formatNodeError copes with the empty object Shoukaku often sends', () => {
    assert.equal(formatNodeError({}), 'no details from the server');
    assert.equal(formatNodeError(null), 'no details from the server');
    assert.equal(formatNodeError(new Error('boom')), 'boom');
    assert.equal(formatNodeError({ message: 'bad gateway', code: 502 }), 'bad gateway, code 502');
    assert.equal(formatNodeError('plain text'), 'plain text');
});

test('formatDuration reads naturally from seconds to hours', () => {
    assert.equal(formatDuration(0), '0s');
    assert.equal(formatDuration(45_000), '45s');
    assert.equal(formatDuration(90_000), '1m 30s');
    assert.equal(formatDuration(120_000), '2m');
    assert.equal(formatDuration(3_600_000), '1h');
    assert.equal(formatDuration(5_400_000), '1h 30m');
});

test('an incident opens once and reports its duration on recovery', () => {
    resetNodeStatus();
    const start = 1_000_000;

    const first = beginIncident(start);
    assert.equal(first.started, true);
    assert.equal(isIncidentActive(), true);

    const second = beginIncident(start + 5_000);
    assert.equal(second.started, false);
    assert.equal(second.durationMs, 5_000);

    assert.equal(endIncident(start + 65_000), 65_000);
    assert.equal(isIncidentActive(), false);
    assert.equal(endIncident(start + 70_000), null);
});

test('reminders fire at most once per interval', () => {
    resetNodeStatus();
    const start = 2_000_000;
    beginIncident(start);

    assert.equal(takeReminder(60_000, start + 30_000), false);
    assert.equal(takeReminder(60_000, start + 61_000), true);
    assert.equal(takeReminder(60_000, start + 90_000), false);
    assert.equal(takeReminder(60_000, start + 130_000), true);
    assert.equal(takeReminder(0, start + 999_000), false);

    resetNodeStatus();
});
