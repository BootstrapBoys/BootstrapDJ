import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ListenerStatsBatcher } from '../dist/core/player/ListenerStatsBatcher.js';

function harness() {
    const writes = [];
    const client = {
        queue: new Map([
            [
                'g1',
                {
                    guildId: 'g1',
                    listenerStatsRows: () => [
                        { userId: 'u1', seconds: 60, deafSeconds: 0 },
                        { userId: 'u2', seconds: 60, deafSeconds: 60 },
                    ],
                },
            ],
            [
                'g2',
                {
                    guildId: 'g2',
                    listenerStatsRows: () => [{ userId: 'u3', seconds: 60, deafSeconds: 0 }],
                },
            ],
        ]),
        db: {
            recordListenerStatsBatch: async rows => {
                writes.push(rows);
            },
        },
    };
    return { client, writes };
}

test('listener stats collect into one cross-guild write', async () => {
    const { client, writes } = harness();
    const batcher = new ListenerStatsBatcher();

    batcher.collect(client);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(writes.length, 1);
    assert.deepEqual(
        writes[0].map(row => [row.guildId, row.userId, row.seconds, row.deafSeconds]),
        [
            ['g1', 'u1', 60, 0],
            ['g1', 'u2', 60, 60],
            ['g2', 'u3', 60, 0],
        ]
    );
});

test('repeated samples merge instead of creating duplicate rows', async () => {
    const { client, writes } = harness();
    const batcher = new ListenerStatsBatcher();

    batcher.add('g1', [{ userId: 'u1', seconds: 60, deafSeconds: 0 }]);
    batcher.add('g1', [{ userId: 'u1', seconds: 60, deafSeconds: 60 }]);
    await batcher.flush(client);

    assert.equal(writes.length, 1);
    assert.deepEqual(
        writes[0].map(row => [row.guildId, row.userId, row.seconds, row.deafSeconds]),
        [['g1', 'u1', 120, 60]]
    );
});

test('failed listener batches are requeued for the next flush', async () => {
    const { client, writes } = harness();
    const original = client.db.recordListenerStatsBatch;
    let fail = true;
    client.db.recordListenerStatsBatch = async rows => {
        if (fail) {
            fail = false;
            throw new Error('database busy');
        }
        writes.push(rows);
    };
    const batcher = new ListenerStatsBatcher();
    batcher.add('g1', [{ userId: 'u1', seconds: 60, deafSeconds: 0 }]);
    await batcher.flush(client);
    assert.equal(writes.length, 0);
    assert.equal(batcher.pendingCount(), 1, 'the failed sample remains pending');
    await batcher.flush(client);
    assert.equal(writes.length, 1);
    assert.deepEqual(
        writes[0].map(row => [row.guildId, row.userId, row.seconds]),
        [['g1', 'u1', 60]]
    );
    client.db.recordListenerStatsBatch = original;
});
