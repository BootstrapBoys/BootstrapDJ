import assert from 'node:assert/strict';
import test from 'node:test';

import { ChannelType, Collection, EmbedBuilder } from 'discord.js';

import VoteSkip, { clearVoteSkip } from '../dist/commands/music/VoteSkip.js';
import TrackStart from '../dist/events/player/TrackStart.js';
import PlayerDestroy from '../dist/events/player/PlayerDestroy.js';
import { makeSong } from './helpers.mjs';

function harness() {
    clearVoteSkip('g1');
    const members = new Collection();
    for (const id of ['u1', 'u2', 'u3']) {
        members.set(id, { id, user: { bot: false } });
    }
    const guild = {
        id: 'g1',
        channels: {
            cache: new Map([
                ['voice-1', { id: 'voice-1', type: ChannelType.GuildVoice, members }],
            ]),
        },
    };
    let skips = 0;
    const player = {
        current: makeSong('song', { uri: 'https://x/song' }),
        voiceId: 'voice-1',
        skip: async () => {
            skips += 1;
        },
    };
    const client = {
        queue: new Map([['g1', player]]),
        db: { getGuildSettings: async () => ({ voteskippercent: '50' }) },
        embed: () => new EmbedBuilder(),
        color: { red: 0xff0000, main: 0x2f3136 },
    };
    const ctx = {
        guild,
        author: { id: 'u1' },
        sendMessage: async payload => payload,
    };
    const command = new VoteSkip(client);
    const run = async (userId = 'u1') => {
        ctx.author.id = userId;
        return await command.run(client, ctx);
    };
    return { command, run, player, client, skips: () => skips };
}

test('a passed vote resets when clearVoteSkip invalidates the old track', async () => {
    const h = harness();

    await h.run('u1');
    clearVoteSkip('g1');
    await h.run('u2');
    assert.equal(h.skips(), 0, 'the replacement vote starts at one again');

    await h.run('u3');
    assert.equal(h.skips(), 1, 'a second voter on the same track still passes the vote');
});

test('track replacement clears the outstanding votes', async () => {
    const h = harness();
    await h.run('u1');

    const start = new TrackStart(
        { guilds: { cache: new Map() } },
        'events/player/TrackStart.js'
    );
    await start.run({ guildId: 'g1' }, h.player.current, {
        nowPlayingCollector: null,
        clearNowPlayingCommandMessages: () => {},
        ensureLookahead: async () => null,
    });

    await h.run('u2');
    assert.equal(h.skips(), 0, 'the new track needs its own vote');
});

test('player destruction clears the outstanding votes', async () => {
    const h = harness();
    await h.run('u1');

    const destroy = new PlayerDestroy(
        { guilds: { cache: new Map() } },
        'events/player/PlayerDestroy.js'
    );
    await destroy.run({ guildId: 'g1' });

    await h.run('u2');
    assert.equal(h.skips(), 0, 'a rebuilt player starts a fresh vote');
});
