import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EmbedBuilder } from 'discord.js';

import Nowplaying from '../dist/commands/music/Nowplaying.js';

test('nowplaying replies with the shared control buttons', async () => {
    const player = {
        current: {
            info: {
                title: 'Song',
                uri: 'https://music.example/song',
                length: 120_000,
                isStream: false,
                artworkUrl: null,
                requester: { toString: () => 'tester#0001' },
            },
        },
        player: { position: 1_000 },
    };
    const client = {
        queue: new Map([['guild', player]]),
        embed: () => new EmbedBuilder(),
        color: { main: 0x2f3136 },
        utils: { progressBar: () => 'bar', formatTime: () => '0:01' },
    };
    const command = new Nowplaying(client);
    let sent;
    const ctx = {
        guild: { id: 'guild', iconURL: () => null },
        sendMessage: async payload => {
            sent = payload;
        },
    };

    await command.run(client, ctx);
    assert.equal(sent.components.length, 2);
    assert.equal(sent.components.flatMap(row => row.components).length, 10);
});
