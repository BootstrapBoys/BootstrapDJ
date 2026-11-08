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
} from '../dist/lib/NodeStatus.js';

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

test('an incident opens once per node and reports its duration on recovery', () => {
    resetNodeStatus();
    const start = 1_000_000;

    const first = beginIncident('primary', start);
    assert.equal(first.started, true);
    assert.equal(isIncidentActive('primary'), true);

    const second = beginIncident('primary', start + 5_000);
    assert.equal(second.started, false);
    assert.equal(second.durationMs, 5_000);

    assert.equal(endIncident('primary', start + 65_000), 65_000);
    assert.equal(isIncidentActive('primary'), false);
    assert.equal(endIncident('primary', start + 70_000), null);
});

test('incidents on different nodes never suppress each other', () => {
    resetNodeStatus();
    const start = 1_500_000;

    assert.equal(beginIncident('primary', start).started, true);
    assert.equal(beginIncident('standby', start).started, true);
    assert.equal(isIncidentActive('primary'), true);
    assert.equal(isIncidentActive('standby'), true);

    assert.equal(endIncident('primary', start + 10_000), 10_000);
    assert.equal(isIncidentActive('primary'), false);
    assert.equal(isIncidentActive('standby'), true, 'ending one node must not clear another');

    assert.equal(beginIncident('standby', start + 15_000).durationMs, 15_000);
    assert.equal(endIncident('standby', start + 20_000), 20_000);
    assert.equal(isIncidentActive('standby'), false);
});

test('reminders fire at most once per interval', () => {
    resetNodeStatus();
    const start = 2_000_000;
    beginIncident('primary', start);

    assert.equal(takeReminder('primary', 60_000, start + 30_000), false);
    assert.equal(takeReminder('primary', 60_000, start + 61_000), true);
    assert.equal(takeReminder('primary', 60_000, start + 90_000), false);
    assert.equal(takeReminder('primary', 60_000, start + 130_000), true);
    assert.equal(takeReminder('primary', 0, start + 999_000), false);

    // A reminder for one node is not charged to another node's incident.
    beginIncident('standby', start + 130_000);
    assert.equal(takeReminder('standby', 60_000, start + 130_000), false);

    resetNodeStatus();
});
