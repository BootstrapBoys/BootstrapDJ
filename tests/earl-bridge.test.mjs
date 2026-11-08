import assert from 'node:assert/strict';
import test from 'node:test';

import { ChannelType, TextChannel } from 'discord.js';
import { LoadType } from 'shoukaku';

import { EarlBridge } from '../dist/plugin/plugins/earlBridge.js';

const GUILD_ID = 'guild-1';
const USER_ID = 'user-1';
const VOICE_ID = 'voice-1';
const TEXT_ID = 'text-1';

function makeTextChannel() {
    const channel = Object.create(TextChannel.prototype);
    channel.id = TEXT_ID;
    channel.permissionsFor = () => ({ has: () => true });
    return channel;
}

function makeMember() {
    return {
        id: USER_ID,
        user: { id: USER_ID, username: 'tester' },
        permissions: { has: () => false },
        roles: { cache: { some: () => false } },
        voice: { channelId: VOICE_ID },
    };
}

function makeTrack(title, length = 1_000) {
    return {
        encoded: title,
        info: {
            title,
            author: 'artist',
            length,
            isStream: false,
            uri: `https://example.test/${title}`,
        },
    };
}

function makePlayer(tracks = []) {
    const calls = { enqueued: [], enqueuedNext: [], persisted: 0, played: 0 };
    const player = {
        isStale: false,
        current: null,
        queue: [...tracks],
        buildTrack: (track, user) => ({
            ...track,
            info: { ...track.info, requester: user },
        }),
        enqueue: (song, remember = true, persist = true) => {
            calls.enqueued.push({ title: song.info.title, remember, persist });
            player.queue.push(song);
        },
        enqueueNext: (song, remember = true, persist = true) => {
            calls.enqueuedNext.push({ title: song.info.title, remember, persist });
            player.queue.unshift(song);
        },
        persist: async () => {
            calls.persisted += 1;
        },
        isPlaying: async () => {
            calls.played += 1;
        },
    };
    return { player, calls };
}

function makeClient({ player, search, settings = {}, optOuts = [], djMode = false }) {
    const text = makeTextChannel();
    const voice = { id: VOICE_ID, type: ChannelType.GuildVoice };
    const guild = {
        id: GUILD_ID,
        name: 'Test Guild',
        members: { me: {}, fetch: async () => makeMember() },
        channels: {
            cache: new Map([
                [TEXT_ID, text],
                [VOICE_ID, voice],
            ]),
            fetch: async () => null,
        },
    };
    const calls = { creates: 0, dj: 0 };
    const client = {
        isReady: () => true,
        guilds: { cache: new Map([[GUILD_ID, guild]]) },
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        config: { maxQueueSize: 100, maxPlaylistSize: 100 },
        db: {
            getDj: async () => {
                calls.dj += 1;
                return { mode: djMode };
            },
            getRoles: async () => [],
            listVoiceOptOuts: async () => optOuts.map(userId => ({ userId })),
            getGuildSettings: async () => settings,
            getSetup: async () => ({ textId: TEXT_ID }),
        },
        queue: {
            get: () => player,
            create: async () => {
                calls.creates += 1;
                return player;
            },
            search: async () => search,
        },
    };
    return { client, calls };
}

function makeBridge(client) {
    return new EarlBridge(client, 'secret');
}

function run(bridge, text) {
    return bridge.run({
        guildId: GUILD_ID,
        voiceChannelId: VOICE_ID,
        textChannelId: TEXT_ID,
        userId: USER_ID,
        text,
    });
}

test('an unrecognized phrase returns before the bot joins voice', async () => {
    const { player } = makePlayer();
    const { client, calls } = makeClient({ player, search: null });
    const bridge = makeBridge(client);

    const result = await run(bridge, 'hello there');

    assert.equal(result.status, 200);
    assert.match(result.message, /not a command/);
    assert.equal(calls.creates, 0, 'validation must happen before queue.create');
});

test('an opted-out member gets silence before the DJ gate runs', async () => {
    const { player } = makePlayer();
    const { client, calls } = makeClient({
        player,
        search: null,
        optOuts: [USER_ID],
        djMode: true,
    });
    const bridge = makeBridge(client);

    const result = await run(bridge, 'skip');

    assert.equal(result.status, 200);
    assert.equal(result.message, '');
    assert.equal(calls.dj, 0, 'the privacy check must precede the DJ check');
    assert.equal(calls.creates, 0);
});

test('a track over the guild length limit is refused instead of queued', async () => {
    const { player, calls } = makePlayer();
    const { client } = makeClient({
        player,
        settings: { maxtracklength: '60' },
        search: { loadType: LoadType.TRACK, data: makeTrack('long', 600_000) },
    });
    const bridge = makeBridge(client);

    const result = await run(bridge, 'play long song');

    assert.equal(result.status, 200);
    assert.match(result.message, /longer than/);
    assert.deepEqual(calls.enqueued, []);
});

test('a playlist is limited per track and persisted once', async () => {
    const { player, calls } = makePlayer();
    const { client } = makeClient({
        player,
        settings: { maxtracklength: '120' },
        search: {
            loadType: LoadType.PLAYLIST,
            data: {
                info: { name: 'Mix' },
                tracks: [makeTrack('one'), makeTrack('two', 600_000), makeTrack('three')],
            },
        },
    });
    const bridge = makeBridge(client);

    const result = await run(bridge, 'play mix');

    assert.equal(result.status, 200);
    assert.match(result.message, /Added 2 tracks/);
    assert.deepEqual(
        calls.enqueued.map(entry => entry.title),
        ['one', 'three']
    );
    assert.ok(
        calls.enqueued.every(entry => entry.persist === false),
        'per-track persist is skipped'
    );
    assert.equal(calls.persisted, 1, 'the playlist is persisted once after the batch');
    assert.equal(calls.played, 1);
});

test('playnext keeps playlist order despite unshifting each track', async () => {
    const { player, calls } = makePlayer();
    const { client } = makeClient({
        player,
        search: {
            loadType: LoadType.PLAYLIST,
            data: {
                info: { name: 'Mix' },
                tracks: [makeTrack('one'), makeTrack('two'), makeTrack('three')],
            },
        },
    });
    const bridge = makeBridge(client);

    await run(bridge, 'playnext mix');

    assert.deepEqual(
        calls.enqueuedNext.map(entry => entry.title),
        ['three', 'two', 'one']
    );
    assert.deepEqual(
        player.queue.map(song => song.info.title),
        ['one', 'two', 'three']
    );
    assert.equal(calls.persisted, 1);
});
