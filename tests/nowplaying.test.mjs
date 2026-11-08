import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EmbedBuilder } from 'discord.js';

import Nowplaying from '../dist/commands/music/Nowplaying.js';

test('nowplaying replies with the compact control buttons', async () => {
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
        registered: null,
        registerNowPlayingMessage(message, duration) {
            this.registered = { message, duration };
        },
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
            return { id: 'nowplaying-message' };
        },
    };

    await command.run(client, ctx);
    assert.equal(sent.components.length, 1);
    assert.equal(player.registered.message.id, 'nowplaying-message');
    assert.equal(player.registered.duration, 120_000);
    assert.deepEqual(
        sent.components[0].components.map(component => component.data.custom_id),
        ['PREV_BUT', 'PAUSE_BUT', 'SKIP_BUT']
    );
});

import Dispatcher from '../dist/core/Dispatcher.js';

test('track-scoped nowplaying messages are cleared on track end', () => {
    const dispatcher = Object.create(Dispatcher.prototype);
    let deleted = 0;
    const message = { id: 'nowplaying-message', delete: async () => { deleted += 1; } };

    dispatcher.registerNowPlayingMessage(message, null);
    assert.equal(dispatcher.hasTrackScopedNowPlayingMessage('nowplaying-message'), true);
    assert.equal(dispatcher.hasTrackScopedNowPlayingMessage('nowplaying-message'), true);
    dispatcher.clearNowPlayingCommandMessages();
    assert.equal(dispatcher.hasTrackScopedNowPlayingMessage('nowplaying-message'), false);
    assert.equal(deleted, 1);
});
