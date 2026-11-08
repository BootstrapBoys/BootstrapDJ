import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { ChannelType, Collection } from 'discord.js';

import {
    clearStaleNowPlaying,
    resetRestoreRetries,
    restoreSession,
    restoreSessions,
} from '../dist/core/player/SessionRestorer.js';
import { toSaved } from '../dist/core/Dispatcher.js';
import { makeSong } from './helpers.mjs';

beforeEach(() => resetRestoreRetries());

const botUser = { id: 'bot', username: 'Bootstrap', tag: 'Bootstrap#0001' };

function makeChannel(type, members = []) {
    const collection = new Collection();
    for (const [index, member] of members.entries()) collection.set(`m${index}`, member);
    return { id: type === ChannelType.GuildVoice ? 'voice-1' : 'text-1', type, members: collection };
}

function makeRestoreHarness({ session, stay = null, listeners = [], text = null } = {}) {
    const calls = {
        create: 0,
        deleted: [],
        played: [],
        volumes: [],
        destroyed: [],
        restored: [],
        released: [],
    };
    const voice = makeChannel(ChannelType.GuildVoice, listeners);
    const textChannel = text ?? makeChannel(ChannelType.GuildText);
    const guild = {
        id: 'guild-1',
        name: 'Guild One',
        channels: {
            cache: new Map([
                [voice.id, voice],
                [textChannel.id, textChannel],
            ]),
        },
    };
    const dispatcher = {
        queue: [],
        current: null,
        history: [],
        loop: 'off',
        autoplay: false,
        paused: false,
        restoring: false,
        skipRecentRecording: false,
        player: {
            setGlobalVolume: async value => calls.volumes.push(value),
            playTrack: async payload => calls.played.push(payload),
        },
        play: async () => calls.restored.push('play'),
        destroy: preserve => calls.destroyed.push(preserve),
    };
    const client = {
        user: botUser,
        shard: null,
        config: {
            botPriority: 0,
            botName: 'Bootstrap',
            searchEngine: 'ytmsearch',
            sessionRestoreAge: 3600,
            sessionEmptyWait: 0,
        },
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        guilds: { cache: new Map([[guild.id, guild]]) },
        queue: {
            has: () => false,
            create: async () => {
                calls.create += 1;
                return dispatcher;
            },
        },
        db: {
            deleteSession: async guildId => calls.deleted.push(guildId),
            getSetup: async () => null,
            get_247: async () => stay,
            getSessions: async () => [session],
            claimSessionLease: async () => true,
            releaseSessionLease: async guildId => calls.released.push(guildId),
        },
    };
    return { client, guild, voice, textChannel, dispatcher, calls };
}

function savedSession(overrides = {}) {
    const track = makeSong('Saved', { uri: 'https://x/saved', encoded: 'ENC1' });
    return {
        guildId: 'guild-1',
        textId: 'text-1',
        voiceId: 'voice-1',
        current: JSON.stringify({ ...toSaved(track), position: 12_000 }),
        queue: JSON.stringify([toSaved(makeSong('Queued', { uri: 'https://x/queued' }))]),
        loop: 'queue',
        autoplay: true,
        volume: 55,
        paused: true,
        updatedAt: new Date(),
        ...overrides,
    };
}

test('restore rejoins, rebuilds queue, volume, loop, autoplay and position', async () => {
    const session = savedSession();
    const harness = makeRestoreHarness({
        session,
        listeners: [{ user: { bot: false } }],
    });

    await restoreSession(harness.client, session, botUser);
    const { calls, dispatcher } = harness;

    assert.equal(calls.create, 1);
    assert.equal(dispatcher.loop, 'queue');
    assert.equal(dispatcher.autoplay, true);
    assert.equal(dispatcher.paused, true);
    assert.equal(dispatcher.skipRecentRecording, true);
    assert.deepEqual(calls.volumes, [55]);
    assert.equal(calls.played.length, 1);
    assert.deepEqual(calls.played[0], {
        track: { encoded: 'ENC1' },
        position: 12_000,
        volume: 55,
        paused: true,
    });
    assert.deepEqual(dispatcher.queue.map(track => track.info.title), ['Queued']);
    assert.equal(dispatcher.current?.info.title, 'Saved');
    assert.equal(dispatcher.history.length, 1);
    assert.equal(dispatcher.restoring, false);
});

test('restore with queued tracks only starts the queue head', async () => {
    const harness = makeRestoreHarness({
        session: savedSession({ current: null }),
        listeners: [{ user: { bot: false } }],
    });
    const session = savedSession({ current: null });

    await restoreSession(harness.client, session, botUser);

    assert.equal(harness.calls.create, 1);
    assert.deepEqual(harness.calls.restored, ['play']);
    assert.equal(harness.calls.played.length, 0);
    assert.deepEqual(harness.dispatcher.queue.map(track => track.info.title), ['Queued']);
    assert.equal(harness.dispatcher.restoring, false);
});

test('an expired session is deleted without joining voice', async () => {
    const harness = makeRestoreHarness({
        session: savedSession({ updatedAt: new Date(Date.now() - 3_600_000) }),
    });

    await restoreSession(harness.client, savedSession({ updatedAt: new Date(0) }), botUser);

    assert.deepEqual(harness.calls.deleted, ['guild-1']);
    assert.equal(harness.calls.create, 0);
});

test('a session whose saved channel is gone is deleted', async () => {
    const harness = makeRestoreHarness({ session: savedSession({ voiceId: 'missing' }) });

    await restoreSession(harness.client, savedSession({ voiceId: 'missing' }), botUser);

    assert.deepEqual(harness.calls.deleted, ['guild-1']);
    assert.equal(harness.calls.create, 0);
});

test('invalid saved JSON is deleted and never creates a player', async () => {
    const harness = makeRestoreHarness({
        session: savedSession({ queue: '{not json', current: null }),
    });

    await restoreSession(harness.client, savedSession({ queue: '{not json', current: null }), botUser);

    assert.deepEqual(harness.calls.deleted, ['guild-1']);
    assert.equal(harness.calls.create, 0);
});

test('an empty channel with no wait window drops the saved queue', async () => {
    const harness = makeRestoreHarness({ session: savedSession(), listeners: [] });

    await restoreSession(harness.client, savedSession(), botUser);

    assert.deepEqual(harness.calls.deleted, ['guild-1']);
    assert.equal(harness.calls.create, 0);
});

test('24/7 restores even when the channel is empty', async () => {
    const harness = makeRestoreHarness({
        session: savedSession(),
        stay: { guildId: 'guild-1' },
        listeners: [],
    });

    await restoreSession(harness.client, savedSession(), botUser);

    assert.equal(harness.calls.create, 1);
    assert.deepEqual(harness.calls.deleted, []);
});

test('a transient restore failure keeps the saved row and backs off', async () => {
    const harness = makeRestoreHarness({
        session: savedSession(),
        listeners: [{ user: { bot: false } }],
    });
    harness.dispatcher.player.playTrack = async () => {
        throw new Error('lavalink 502');
    };

    await restoreSession(harness.client, savedSession(), botUser);

    assert.equal(harness.calls.create, 1);
    assert.deepEqual(harness.calls.destroyed, [true], 'the half-built player is torn down');
    assert.deepEqual(harness.calls.deleted, [], 'a transport failure must not delete the queue');
    assert.equal(harness.dispatcher.restoring, false);

    // Inside the backoff window a second attempt must not rejoin voice.
    await restoreSession(harness.client, savedSession(), botUser);
    assert.equal(harness.calls.create, 1);
    assert.deepEqual(harness.calls.deleted, []);
});

test('a transient boot-restore failure releases the lease and keeps the row', async () => {
    const harness = makeRestoreHarness({
        session: savedSession(),
        listeners: [{ user: { bot: false } }],
    });
    harness.dispatcher.player.playTrack = async () => {
        throw new Error('lavalink 502');
    };

    await restoreSessions(harness.client);

    assert.deepEqual(harness.calls.deleted, []);
    assert.deepEqual(harness.calls.released, ['guild-1']);
});

test('boot restore is skipped for a non-preferred fleet child', async () => {
    const harness = makeRestoreHarness({ session: savedSession() });
    harness.client.config.botPriority = 1;

    await restoreSessions(harness.client);

    assert.equal(harness.calls.create, 0);
    assert.deepEqual(harness.calls.deleted, []);
});

test('stale now-playing panels are deleted but the setup mock is preserved', async () => {
    const deleted = [];
    const messages = new Collection();
    const panel = {
        id: 'panel-1',
        author: { id: 'bot' },
        components: [{}],
        embeds: [{ author: { name: 'Now Playing' } }],
        delete: async () => deleted.push('panel-1'),
    };
    const setup = {
        id: 'setup-1',
        author: { id: 'bot' },
        components: [{}],
        embeds: [{ author: { name: 'Now Playing' } }],
        delete: async () => deleted.push('setup-1'),
    };
    const human = {
        id: 'human-1',
        author: { id: 'human' },
        components: [{}],
        embeds: [{ author: { name: 'Now Playing' } }],
        delete: async () => deleted.push('human-1'),
    };
    messages.set(panel.id, panel);
    messages.set(setup.id, setup);
    messages.set(human.id, human);
    const channel = { messages: { fetch: async () => messages } };

    await clearStaleNowPlaying({ user: { id: 'bot' } }, channel, 'setup-1');

    assert.deepEqual(deleted, ['panel-1']);
});
