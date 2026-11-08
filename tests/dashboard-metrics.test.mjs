import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectMetrics } from '../dist/dashboard/metrics.js';

test('collectMetrics reports memory, event loop and player counts', () => {
    const client = {
        guilds: { cache: new Map([['g1', {}]]) },
        queue: new Map([
            [
                'g1',
                {
                    guildId: 'g1',
                    current: { info: { title: 'Track' } },
                    paused: false,
                    queue: [{}, {}],
                    autoplay: true,
                    loop: 'off',
                },
            ],
        ]),
        ws: { ping: 42 },
    };

    const metrics = collectMetrics(client);

    assert.equal(metrics.guilds, 1);
    assert.equal(metrics.wsPing, 42);
    assert.equal(metrics.players.length, 1);
    assert.equal(metrics.players[0].guildId, 'g1');
    assert.equal(metrics.players[0].queue, 2);
    assert.equal(metrics.players[0].playing, true);
    assert.equal(metrics.players[0].autoplay, true);
    assert.equal(typeof metrics.memory.rss, 'number');
    assert.equal(typeof metrics.eventLoop.p99, 'number');
    assert.ok(metrics.memory.heapUsed > 0);
});
