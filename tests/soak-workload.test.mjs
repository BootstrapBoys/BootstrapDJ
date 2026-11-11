import assert from 'node:assert/strict';
import { test } from 'node:test';

import { workloadConfig, workloadStep } from '../tooling/soak/workload.mjs';

test('workloadConfig requires the test guild, voice channel and user', () => {
    assert.throws(() => workloadConfig({}), /SOAK_GUILD_ID/);
    const config = workloadConfig({
        SOAK_GUILD_ID: 'g',
        SOAK_VOICE_CHANNEL_ID: 'v',
        SOAK_USER_ID: 'u',
        SOAK_BRIDGE_SECRET: 's',
    });
    assert.equal(config.guildId, 'g');
    assert.equal(config.bridgeUrl, 'http://127.0.0.1:8792/voice/command');
});

test('workloadConfig accepts multiple guild targets', () => {
    const config = workloadConfig({
        SOAK_TARGETS: JSON.stringify([
            { guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' },
            { guildId: 'g2', voiceChannelId: 'v2' },
        ]),
        SOAK_USER_ID: 'u',
        SOAK_BRIDGE_SECRET: 's',
    });
    assert.equal(config.targets.length, 2);
    assert.equal(config.guildId, 'g1');
    assert.equal(config.targets[1].guildId, 'g2');
});

test('workloadStep rotates across guild targets', async () => {
    const originalFetch = globalThis.fetch;
    const guilds = [];
    globalThis.fetch = async (url, options) => {
        guilds.push(JSON.parse(options.body).guildId);
        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
    try {
        const config = workloadConfig({
            SOAK_TARGETS: JSON.stringify([
                { guildId: 'g1', voiceChannelId: 'v1' },
                { guildId: 'g2', voiceChannelId: 'v2' },
            ]),
            SOAK_USER_ID: 'u',
            SOAK_BRIDGE_SECRET: 's',
        });
        await workloadStep(config, 0);
        await workloadStep(config, 1);
        assert.deepEqual(guilds, ['g1', 'g2']);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('workloadStep sends an authenticated bridge command', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, options) => {
        captured = { url, options, body: JSON.parse(options.body) };
        return new Response(JSON.stringify({ ok: true, message: 'Queued.' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
    try {
        const config = workloadConfig({
            SOAK_GUILD_ID: 'g',
            SOAK_VOICE_CHANNEL_ID: 'v',
            SOAK_USER_ID: 'u',
            SOAK_BRIDGE_SECRET: 'secret',
        });
        const result = await workloadStep(config, 0);
        assert.equal(result.ok, true);
        assert.equal(captured.body.guildId, 'g');
        assert.equal(captured.body.text, 'play nf fear');
        assert.equal(captured.options.headers.authorization, 'Bearer secret');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('workloadStep reports a missing bridge secret without sending', async () => {
    const config = workloadConfig({
        SOAK_GUILD_ID: 'g',
        SOAK_VOICE_CHANNEL_ID: 'v',
        SOAK_USER_ID: 'u',
    });
    const result = await workloadStep(config, 0);
    assert.equal(result.ok, false);
    assert.match(result.error, /required/);
});
