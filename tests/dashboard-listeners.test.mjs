import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyDashboardListenerCount } from '../dist/dashboard/cleanup.js';
import {
    clearDashboardListeners,
    getDashboardListenerCount,
    setDashboardListenerCount,
} from '../dist/dashboard/listeners.js';

function fakeClient() {
    return {
        config: { dashboardVoiceChannelId: 'vc' },
        queue: new Map(),
        guilds: { cache: new Map() },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        db: { getGuildSettings: async () => ({ timeoutlisteners: '5' }) },
    };
}

test('dashboard listener counts are absolute and clear stale guild state', () => {
    clearDashboardListeners();
    assert.equal(getDashboardListenerCount('guild'), 0);
    assert.equal(setDashboardListenerCount('guild', 2), 2);
    assert.equal(getDashboardListenerCount('guild'), 2);
    assert.equal(setDashboardListenerCount('guild', 1), 1);
    assert.equal(getDashboardListenerCount('guild'), 1);
    assert.equal(setDashboardListenerCount('guild', 0), 0);
    assert.equal(getDashboardListenerCount('guild'), 0);
});

test('applying a listener count normalizes negative and non-finite values', () => {
    const client = fakeClient();
    assert.equal(applyDashboardListenerCount(client, 'guild', -4), 0);
    assert.equal(applyDashboardListenerCount(client, 'guild', Number.NaN), 0);
    assert.equal(applyDashboardListenerCount(client, 'guild', 2), 2);
    clearDashboardListeners();
});
