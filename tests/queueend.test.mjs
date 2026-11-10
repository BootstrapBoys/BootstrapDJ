import assert from 'node:assert/strict';
import { test } from 'node:test';

import QueueEnd from '../dist/events/player/QueueEnd.js';

function harness(overrides = {}) {
    let destroyed = 0;
    const dispatcher = {
        guildId: 'guild',
        loop: 'off',
        leaveOnEnd: false,
        autoplay: false,
        queue: [],
        voiceId: 'vc',
        destroy: () => {
            destroyed += 1;
        },
        ...overrides,
    };
    const client = {
        config: { dashboardVoiceChannelId: 'vc' },
        guilds: { cache: new Map([['guild', { id: 'guild' }]]) },
        db: {},
    };
    return { event: new QueueEnd(client, 'QueueEnd.js'), dispatcher, destroyed: () => destroyed };
}

test('queue end leaves the configured dashboard channel immediately', async () => {
    const testHarness = harness();
    await testHarness.event.run(null, null, testHarness.dispatcher);
    assert.equal(testHarness.destroyed(), 1);
});

test('queue end keeps the dashboard player while tracks remain', async () => {
    const testHarness = harness({ queue: [{}] });
    await testHarness.event.run(null, null, testHarness.dispatcher);
    assert.equal(testHarness.destroyed(), 0);
});
