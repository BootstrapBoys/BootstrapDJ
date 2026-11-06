import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import { ChannelType, Collection } from 'discord.js';

import VoiceStateUpdate from '../dist/events/client/VoiceStateUpdate.js';

function makeHarness({ humans = 0, stay = null, timeout = '0.03' } = {}) {
    let destroys = 0;
    let resumes = 0;
    const members = new Collection();
    for (let index = 0; index < humans; index++) {
        members.set(`human-${index}`, { user: { bot: false } });
    }
    const channel = { id: 'vc', type: ChannelType.GuildVoice, members };
    const me = {
        id: 'bot',
        permissions: { has: () => true },
        voice: { channelId: 'vc', channel, suppress: false, setSuppressed: async () => {} },
    };
    const guild = {
        id: 'guild',
        members: { me, cache: new Map([['bot', me]]) },
        channels: { cache: new Map([['vc', channel]]) },
    };
    const player = {
        pauseWhenEmpty: false,
        destroy: () => { destroys += 1; },
        resume247: () => { resumes += 1; },
    };
    const client = {
        user: { id: 'bot' },
        shuttingDown: false,
        queue: new Map([['guild', player]]),
        guilds: { cache: new Map([['guild', guild]]) },
        db: {
            getGuildSettings: async () => ({ timeoutlisteners: timeout }),
            get_247: async () => stay,
        },
    };
    const event = new VoiceStateUpdate(client, 'VoiceStateUpdate.js');
    const state = {
        id: 'user',
        guild,
        channel: null,
        channelId: null,
        member: { user: { bot: false } },
    };
    return { event, state, player, me, channel, counts: () => ({ destroys, resumes }) };
}

test('leaving an empty channel schedules one teardown and replaces duplicate timers', async () => {
    const harness = makeHarness();
    await harness.event.run({}, harness.state);
    await harness.event.run({}, harness.state);
    await delay(55);
    assert.deepEqual(harness.counts(), { destroys: 1, resumes: 0 });
});

test('a listener joining before the timer cancels the teardown', async () => {
    const harness = makeHarness({ humans: 1 });
    await harness.event.run({}, harness.state);
    harness.channel.members.set('human-1', { user: { bot: false } });
    await harness.event.run({}, {
        ...harness.state,
        channelId: 'vc',
        channel: harness.channel,
    });
    await delay(55);
    assert.deepEqual(harness.counts(), { destroys: 0, resumes: 0 });
});

test('the bot leaving voice destroys its player', async () => {
    const harness = makeHarness();
    harness.me.voice.channelId = null;
    harness.me.voice.channel = null;
    await harness.event.run({}, { ...harness.state, id: 'bot' });
    assert.deepEqual(harness.counts(), { destroys: 1, resumes: 0 });
});

test('24/7 sessions pause instead of scheduling a teardown', async () => {
    const harness = makeHarness({ stay: { guildId: 'guild' } });
    await harness.event.run({}, harness.state);
    assert.equal(harness.player.pauseWhenEmpty, true);
    await delay(55);
    assert.deepEqual(harness.counts(), { destroys: 0, resumes: 0 });
});

test('timeoutlisteners=0 keeps the bot connected', async () => {
    const harness = makeHarness({ timeout: '0' });
    await harness.event.run({}, harness.state);
    await delay(55);
    assert.deepEqual(harness.counts(), { destroys: 0, resumes: 0 });
});

test('a listener joining a paused 24/7 session resumes it', async () => {
    const harness = makeHarness({ stay: { guildId: 'guild' } });
    harness.player.pauseWhenEmpty = true;
    harness.channel.members.set('human-1', { user: { bot: false } });
    await harness.event.run({}, {
        ...harness.state,
        channelId: 'vc',
        channel: harness.channel,
    });
    assert.deepEqual(harness.counts(), { destroys: 0, resumes: 1 });
    assert.equal(harness.player.pauseWhenEmpty, false);
});
