import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChannelType } from 'discord.js';

import { ensureDashboardPlayer } from '../dist/dashboard/playback.js';

function makeHarness({ existing = null, settings = {}, envChannel = '' } = {}) {
    let created = 0;
    const player = { dashboardMode: false, dashboardVoiceChannelId: null, isStale: false };
    const voice = {
        id: 'vc',
        type: ChannelType.GuildVoice,
        isTextBased: () => false,
        isThread: () => false,
        permissionsFor: () => ({ has: () => true }),
    };
    const text = {
        id: 'tc',
        type: ChannelType.GuildText,
        isTextBased: () => true,
        isThread: () => false,
        permissionsFor: () => ({ has: () => true }),
    };
    const guild = {
        id: 'g1',
        systemChannel: null,
        members: { me: { id: 'bot' } },
        channels: {
            cache: new Map([
                ['vc', voice],
                ['tc', text],
            ]),
            fetch: async () => null,
        },
    };
    const queue = new Map(existing ? [['g1', existing]] : []);
    queue.create = async () => {
        created += 1;
        return player;
    };
    const client = {
        guilds: { cache: new Map([['g1', guild]]) },
        queue,
        config: { dashboardVoiceChannelId: envChannel },
        db: {
            getGuildSettings: async () => settings,
        },
    };
    return { client, player, created: () => created };
}

test('dashboard playback joins the configured channel without a human listener', async () => {
    const harness = makeHarness();
    const result = await ensureDashboardPlayer(harness.client, 'g1', 'vc');

    assert.equal(result.ok, true);
    assert.equal(harness.created(), 1);
    assert.equal(harness.player.dashboardMode, true);
});

test('dashboard playback refuses a missing channel configuration', async () => {
    const harness = makeHarness();
    const result = await ensureDashboardPlayer(harness.client, 'g1', '');

    assert.deepEqual(result, {
        ok: false,
        status: 409,
        error: 'The bot is not connected. Set the dashboard voice channel setting or DASHBOARD_VOICE_CHANNEL_ID to enable browser-only playback.',
    });
    assert.equal(harness.created(), 0);
});

test('dashboard playback uses the per-guild voice channel setting', async () => {
    const harness = makeHarness({ settings: { dashboardvoicechannel: 'vc' } });
    const result = await ensureDashboardPlayer(harness.client, 'g1');

    assert.equal(result.ok, true);
    assert.equal(harness.created(), 1);
    assert.equal(harness.player.dashboardVoiceChannelId, 'vc');
});

test('dashboard playback falls back to the host voice channel', async () => {
    const harness = makeHarness({ envChannel: 'vc' });
    const result = await ensureDashboardPlayer(harness.client, 'g1');

    assert.equal(result.ok, true);
    assert.equal(harness.created(), 1);
    assert.equal(harness.player.dashboardVoiceChannelId, 'vc');
});

test('dashboard playback reuses a healthy player without rejoining', async () => {
    const existing = { dashboardMode: true, isStale: false };
    const harness = makeHarness({ existing });
    const result = await ensureDashboardPlayer(harness.client, 'g1', 'vc');

    assert.equal(result.ok, true);
    assert.equal(result.player, existing);
    assert.equal(harness.created(), 0);
});
