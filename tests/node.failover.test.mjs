import assert from 'node:assert/strict';
import test from 'node:test';

import NodeDestroy from '../dist/events/player/NodeDestroy.js';
import { beginIncident, isIncidentActive, resetNodeStatus } from '../dist/lib/NodeStatus.js';

function makeClient() {
    const calls = { held: [], migrated: [] };
    const nodes = new Map([
        ['primary', { name: 'primary', state: 1 }],
        ['standby', { name: 'standby', state: 1 }],
    ]);
    const client = {
        config: {
            lavalink: [{ name: 'primary' }, { name: 'standby' }],
            nodeAlertReminderMinutes: 15,
        },
        logger: {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
            success: () => {},
        },
        queue: {
            holdPositions: name => calls.held.push(name),
            migrateToNode: async target => {
                calls.migrated.push(target?.name ?? null);
                return 1;
            },
        },
        shoukaku: { nodes, removeNode: () => {} },
    };
    return { client, calls };
}

test('a primary loss fails over even when an alert incident is already open', async () => {
    resetNodeStatus();
    const { client, calls } = makeClient();
    const event = new NodeDestroy(client, 'events/player/NodeDestroy.ts');

    // NodeError (or a standby event) already reported this outage. The alert
    // gate must not swallow the migration that the destroy event owns.
    beginIncident('primary', 1_000);

    await event.run('primary', 1006, 'socket closed');
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls.held, ['primary']);
    assert.deepEqual(calls.migrated, ['standby']);
});

test('a first primary loss opens the incident and fails over exactly once', async () => {
    resetNodeStatus();
    const { client, calls } = makeClient();
    const event = new NodeDestroy(client, 'events/player/NodeDestroy.ts');

    await event.run('primary', 1001, 'restarting');
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls.migrated, ['standby']);
    assert.equal(isIncidentActive('primary'), true);
    assert.equal(isIncidentActive('standby'), false);
});
