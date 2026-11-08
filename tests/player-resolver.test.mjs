import assert from 'node:assert/strict';
import test from 'node:test';

import { TextChannel } from 'discord.js';

import SetupSystem from '../dist/events/client/SetupSystem.js';
import { resolvePlayer, refreshStalePlayer } from '../dist/lib/PlayerResolver.js';
import { defineMusicCommand } from '../dist/lib/musicCommand.js';

function makeHarness({ stale = true, hasNode = true } = {}) {
    const calls = { created: 0, run: null };
    const voice = { id: 'voice' };
    const text = { id: 'text' };
    const stalePlayer = {
        guildId: 'guild',
        channelId: 'text',
        voiceId: 'voice',
        isStale: stale,
        queue: [],
    };
    const freshPlayer = { guildId: 'guild', channelId: 'text', voiceId: 'voice', isStale: false };
    const guild = {
        id: 'guild',
        channels: { cache: new Map([[voice.id, voice], [text.id, text]]) },
    };
    const client = {
        queue: {
            get: () => stalePlayer,
            hasNode,
            create: async () => {
                calls.created += 1;
                return freshPlayer;
            },
        },
        guilds: { cache: new Map([[guild.id, guild]]) },
        color: { red: 0xff0000, main: 0x2f3136 },
        embed: () => ({ setColor() { return this; }, setDescription() { return this; } }),
    };
    return { client, guild, voice, text, stalePlayer, freshPlayer, calls };
}

test('a fresh player is returned without a rebuild', async () => {
    const harness = makeHarness({ stale: false });

    const player = await resolvePlayer(harness.client, 'guild', harness.voice, harness.text);

    assert.equal(player, harness.stalePlayer);
    assert.equal(harness.calls.created, 0);
});

test('a stale player is rebuilt with the live channels', async () => {
    const harness = makeHarness();

    const player = await resolvePlayer(harness.client, 'guild', harness.voice, harness.text);

    assert.equal(player, harness.freshPlayer);
    assert.equal(harness.calls.created, 1);
});

test('a stale player with no usable node is an error, not a silent success', async () => {
    const harness = makeHarness({ hasNode: false });

    await assert.rejects(
        resolvePlayer(harness.client, 'guild', harness.voice, harness.text),
        /stale and cannot be rebuilt/
    );
});

test('a missing player stays missing so the command can show its normal reply', async () => {
    const harness = makeHarness();
    harness.client.queue.get = () => undefined;

    const player = await resolvePlayer(harness.client, 'guild', harness.voice, harness.text);

    assert.equal(player, undefined);
    assert.equal(harness.calls.created, 0);
});

test('a non-play music command receives the rebuilt player', async () => {
    const harness = makeHarness();
    const CommandClass = defineMusicCommand({
        name: 'loop',
        description: { content: 'loop', usage: 'loop', examples: ['loop'] },
        requirePlayer: true,
        run: async ({ player }) => {
            harness.calls.run = player;
        },
    });
    const command = new CommandClass({ config: {}, logger: {} });
    const ctx = {
        guild: harness.guild,
        channelId: 'text',
        voiceChannel: harness.voice,
        sendMessage: async () => {},
    };

    await command.run(harness.client, ctx, []);

    assert.equal(harness.calls.created, 1);
    assert.equal(harness.calls.run, harness.freshPlayer);
});

test('refreshStalePlayer skips commands without player preconditions', async () => {
    const harness = makeHarness();

    await refreshStalePlayer(
        harness.client,
        { player: { voice: false, active: false } },
        'guild',
        harness.voice,
        harness.text
    );

    assert.equal(harness.calls.created, 0);
});

test('a setup request rebuilds a stale player before searching', async () => {
    const harness = makeHarness();
    let deleted = 0;
    const channel = Object.create(TextChannel.prototype);
    Object.assign(channel, { id: 'text', guild: { id: 'guild' } });
    const voice = { id: 'voice', permissionsFor: () => ({ has: () => true }) };
    harness.client.user = { id: 'bot' };
    harness.client.logger = { info: () => {}, warn: () => {}, error: () => {} };
    harness.client.db = { getSetup: async () => null };
    const message = {
        inGuild: () => true,
        guildId: 'guild',
        guild: { id: 'guild', members: { me: { voice: { channel: null } } } },
        channel,
        member: { voice: { channel: voice, channelId: 'voice' } },
        content: 'query',
        delete: async () => {
            deleted += 1;
        },
    };
    const event = new SetupSystem(harness.client, 'events/client/SetupSystem.js');

    await event.run(message);

    assert.equal(harness.calls.created, 1);
    assert.equal(deleted, 1);
});
