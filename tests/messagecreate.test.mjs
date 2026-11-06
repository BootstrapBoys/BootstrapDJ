import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChannelType, EmbedBuilder, Message } from 'discord.js';

import MessageCreate from '../dist/events/client/MessageCreate.js';

function makeHarness({ content, setupTextId = 'setup-channel' }) {
    let setupEmitted = 0;
    let commandRuns = 0;
    const replies = [];
    const member = {
        id: 'user',
        roles: { cache: new Map() },
        permissions: { has: () => true },
        voice: { channel: { id: 'voice', type: ChannelType.GuildVoice }, channelId: 'voice' },
    };
    const me = {
        id: 'bot',
        roles: { cache: new Map() },
        permissions: { has: () => true },
        voice: { channel: null, channelId: null },
    };
    const guild = { id: 'guild', name: 'Guild', prefix: '!', members: { me } };
    const channel = {
        id: 'setup-channel',
        isThread: () => false,
        permissionsFor: () => ({ has: () => true }),
        send: async payload => replies.push(payload),
    };
    const command = {
        name: 'skip',
        aliases: [],
        cooldown: 0.001,
        args: false,
        player: { voice: false, dj: false, active: false, djPerm: null },
        permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
        run: async () => {
            commandRuns += 1;
        },
    };
    const client = {
        commands: new Map([['skip', command]]),
        aliases: new Map(),
        cooldown: new Map(),
        config: { owners: [], prefix: '!' },
        queue: new Map(),
        user: { id: 'bot' },
        utils: { scheduleDelete: () => {} },
        emit: () => {
            setupEmitted += 1;
        },
        db: {
            getSetup: async () => (setupTextId ? { textId: setupTextId } : null),
            get: async () => ({ prefix: '!' }),
            getUserPrefix: async () => null,
            getGuildSettings: async () => ({ deleteafter: '0' }),
            getCommandMapping: async () => null,
            getCommandAlias: async () => null,
            isCommandAllowed: async () => true,
            getDj: async () => null,
            getRoles: async () => [],
            recordCommand: async () => {},
        },
        preferredBotStatus: async () => ({ allowed: true, name: null }),
        logger: { error: console.error, warn: console.warn },
        embed: () => new EmbedBuilder(),
        color: { red: 0xff0000, main: 0x2f3136 },
    };
    const message = Object.create(Message.prototype);
    const fields = {
        author: { id: 'user', bot: false, send: async payload => replies.push(payload) },
        member,
        guild,
        guildId: 'guild',
        channel,
        channelId: 'setup-channel',
        content,
        id: 'message',
        client,
        createdAt: new Date(),
        createdTimestamp: Date.now(),
        inGuild: () => true,
        reply: async payload => {
            replies.push(payload);
            return { delete: async () => {} };
        },
        delete: async () => {},
    };
    for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(message, key, { value, writable: true, configurable: true });
    }
    const event = new MessageCreate(client, 'MessageCreate.js');
    return {
        event,
        message,
        replies,
        counts: () => ({ setupEmitted, commandRuns }),
    };
}

test('a known prefix command in the setup channel reaches the command handler', async () => {
    const harness = makeHarness({ content: '!skip' });
    await harness.event.run(harness.message);
    assert.deepEqual(harness.counts(), { setupEmitted: 0, commandRuns: 1 });
});

test('an ordinary setup message stays a setup request', async () => {
    const harness = makeHarness({ content: 'some song' });
    await harness.event.run(harness.message);
    assert.deepEqual(harness.counts(), { setupEmitted: 1, commandRuns: 0 });
});

test('an unknown prefixed message stays a setup request', async () => {
    const harness = makeHarness({ content: '!not-a-command' });
    await harness.event.run(harness.message);
    assert.deepEqual(harness.counts(), { setupEmitted: 1, commandRuns: 0 });
});
