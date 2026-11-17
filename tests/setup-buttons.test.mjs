import assert from 'node:assert/strict';
import test from 'node:test';

import { EmbedBuilder } from 'discord.js';

import SetupButtons from '../dist/events/client/SetupButtons.js';
import { buttonReply } from '../dist/lib/SetupSystem.js';

function fakeInteraction({ deferred = false, replied = false, ephemeral = true } = {}) {
    const calls = { deferReply: [], editReply: 0, followUp: 0, reply: 0 };
    const feedback = { delete: async () => {} };
    const interaction = {
        deferred,
        replied,
        ephemeral,
        member: { voice: { channel: null } },
        guildId: 'guild-1',
        customId: 'PAUSE_BUT',
        message: { id: 'message-1', edit: async () => {} },
        deferReply: async options => {
            calls.deferReply.push(options);
            interaction.deferred = true;
        },
        editReply: async () => {
            calls.editReply += 1;
            return feedback;
        },
        followUp: async () => {
            calls.followUp += 1;
            return feedback;
        },
        reply: async () => {
            calls.reply += 1;
            return feedback;
        },
    };
    return { interaction, calls };
}

test('a deferred button reply is edited, not followed up', async () => {
    const { interaction, calls } = fakeInteraction({ deferred: true });

    await buttonReply(interaction, 'Paused the music.', 0x2f3136);

    assert.equal(calls.editReply, 1);
    assert.equal(calls.followUp, 0);
    assert.equal(calls.reply, 0);
});

test('a replied button interaction is edited in place', async () => {
    const { interaction, calls } = fakeInteraction({ replied: true });

    await buttonReply(interaction, 'Paused the music.', 0x2f3136);

    assert.equal(calls.editReply, 1);
    assert.equal(calls.followUp, 0);
});

test('an unacknowledged button interaction replies instead of following up', async () => {
    const { interaction, calls } = fakeInteraction();

    await buttonReply(interaction, 'Paused the music.', 0x2f3136);

    assert.equal(calls.reply, 1);
    assert.equal(calls.followUp, 0);
    assert.equal(calls.editReply, 0);
});

test('setup buttons defer ephemerally and edit that reply', async () => {
    const client = { color: { red: 0xff0000, main: 0x2f3136 } };
    const event = new SetupButtons(client, 'events/client/SetupButtons.ts');
    const { interaction, calls } = fakeInteraction();

    await event.run(interaction);

    assert.deepEqual(calls.deferReply, [{ ephemeral: true }]);
    assert.equal(interaction.deferred, true);
    assert.equal(calls.editReply, 1);
    assert.equal(calls.followUp, 0);
});

test('setup buttons never defer twice', async () => {
    const client = { color: { red: 0xff0000, main: 0x2f3136 } };
    const event = new SetupButtons(client, 'events/client/SetupButtons.ts');
    const { interaction, calls } = fakeInteraction({ deferred: true });

    await event.run(interaction);

    assert.deepEqual(calls.deferReply, []);
    assert.equal(calls.editReply, 1);
    assert.equal(calls.followUp, 0);
});

function panelClient() {
    return {
        user: { displayAvatarURL: () => undefined },
        config: { icons: {} },
        embed: () => new EmbedBuilder(),
        utils: { formatTime: ms => `${Math.round(ms / 1000)}s` },
    };
}

function panelPlayer(info) {
    return {
        current: {
            info: {
                title: 'Song',
                uri: 'https://x/song',
                length: 1000,
                isStream: false,
                requester: 'user#0001',
                ...info,
            },
        },
    };
}

test('a setup-panel button refresh keeps the artist', () => {
    const event = new SetupButtons(panelClient(), 'events/client/SetupButtons.ts');

    const embed = event.nowPlayingEmbed(panelPlayer({ author: 'The Artist' }), 'en-US');

    assert.match(embed.data.description, /\) by The Artist -/);
});

test('a setup-panel button refresh omits a blank artist', () => {
    const event = new SetupButtons(panelClient(), 'events/client/SetupButtons.ts');

    const embed = event.nowPlayingEmbed(panelPlayer({ author: '   ' }), 'en-US');

    assert.doesNotMatch(embed.data.description, /\) by /);
});

test('an autoplay pick is attributed to Autoplay in the button refresh', () => {
    const event = new SetupButtons(panelClient(), 'events/client/SetupButtons.ts');
    const player = {
        current: {
            autoplay: true,
            info: {
                title: 'Song',
                uri: 'https://x/song',
                author: 'The Artist',
                length: 1000,
                isStream: false,
                requester: 'bot',
            },
        },
    };

    const embed = event.nowPlayingEmbed(player, 'en-US');

    assert.match(embed.data.description, /Requested by Autoplay/);
    assert.match(embed.data.description, /by The Artist/);
});
