import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeMigrator } from '../dist/core/player/NodeMigrator.js';
import { makeSong } from './helpers.mjs';

function makeGuild() {
    const voice = { id: 'voice-1' };
    const text = { id: 'text-1' };
    return {
        guild: {
            id: 'guild-1',
            channels: {
                cache: new Map([
                    [voice.id, voice],
                    [text.id, text],
                ]),
            },
        },
        voice,
        text,
    };
}

function makeDispatcher(overrides = {}) {
    const track = makeSong('current', { uri: 'https://x/current' });
    const events = [];
    const dispatcher = {
        guildId: 'guild-1',
        channelId: 'text-1',
        voiceId: 'voice-1',
        current: track,
        queue: [makeSong('next')],
        history: [makeSong('old')],
        previous: makeSong('previous'),
        loop: 'repeat',
        autoplay: true,
        seed: makeSong('seed'),
        seeds: [makeSong('seed')],
        filters: ['bassboost'],
        filterValues: { bassboost: 1 },
        leaveOnEnd: true,
        pauseWhenEmpty: true,
        paused247: true,
        skipRecentRecording: true,
        paused: true,
        volume: 100,
        resumePosition: null,
        player: {
            node: { name: 'old-node' },
            position: 12_000,
            track: {},
            setGlobalVolume: async value => events.push(`volume:${value}`),
            seekTo: async value => events.push(`seek:${value}`),
            setPaused: async value => events.push(`paused:${value}`),
        },
        destroyAndWait: async preserve => events.push(`teardown:${preserve}`),
        play: async () => events.push('play'),
        ...overrides,
    };
    return { dispatcher, events };
}

function makeClient(guild) {
    const events = [];
    return {
        events,
        client: {
            guilds: { cache: new Map([[guild.guild.id, guild.guild]]) },
            shoukaku: {
                emitPlayerEvent: name => events.push(name),
            },
            logger: { info: () => {}, warn: () => {}, error: () => {} },
        },
    };
}

function makeRebuilt(events) {
    return {
        current: null,
        queue: [],
        history: [],
        previous: null,
        loop: 'off',
        autoplay: false,
        seed: null,
        seeds: [],
        filters: [],
        filterValues: {},
        leaveOnEnd: false,
        pauseWhenEmpty: false,
        paused247: false,
        skipRecentRecording: false,
        paused: false,
        resumePosition: 99,
        player: {
            track: {},
            setGlobalVolume: async value => events.push(`volume:${value}`),
            seekTo: async value => events.push(`seek:${value}`),
            setPaused: async value => events.push(`paused:${value}`),
        },
        play: async () => events.push('play'),
    };
}

const node = { name: 'new-node' };

test('rebuild transfers current, queue, history and seeds exactly once', async () => {
    const guild = makeGuild();
    const { dispatcher, events } = makeDispatcher();
    const { client, events: clientEvents } = makeClient(guild);
    const rebuilt = makeRebuilt(events);
    const migrator = new NodeMigrator(
        client,
        async () => rebuilt,
        { info: () => {}, warn: () => {}, error: () => {} }
    );

    const result = await migrator.rebuild(dispatcher, node);

    assert.equal(result, rebuilt);
    assert.equal(rebuilt.current, null);
    assert.deepEqual(
        rebuilt.queue.map(track => track.info.title),
        ['current', 'next']
    );
    assert.deepEqual(rebuilt.history.map(track => track.info.title), ['old']);
    assert.equal(rebuilt.previous?.info.title, 'previous');
    assert.equal(rebuilt.loop, 'repeat');
    assert.equal(rebuilt.autoplay, true);
    assert.equal(rebuilt.seed?.info.title, 'seed');
    assert.equal(rebuilt.seeds.length, 1);
    assert.deepEqual(rebuilt.filters, ['bassboost']);
    assert.deepEqual(rebuilt.filterValues, { bassboost: 1 });
    assert.equal(rebuilt.leaveOnEnd, true);
    assert.equal(rebuilt.pauseWhenEmpty, true);
    assert.equal(rebuilt.paused247, true);
    assert.equal(rebuilt.skipRecentRecording, true);
    assert.equal(rebuilt.resumePosition, null);
    assert.equal(events[0], 'teardown:true');
    assert.ok(events.includes('volume:100'));
    assert.ok(events.includes('seek:12000'));
    assert.ok(events.includes('paused:true'));
    assert.ok(clientEvents.includes('playerCreate'));
});

test('rebuild samples the position before the old player is torn down', async () => {
    const guild = makeGuild();
    const order = [];
    const { dispatcher, events } = makeDispatcher({
        player: {
            node: { name: 'old-node' },
            get position() {
                order.push('position');
                return 8000;
            },
            track: {},
            setGlobalVolume: async () => {},
            seekTo: async value => order.push(`seek:${value}`),
            setPaused: async () => {},
        },
    });
    const { client } = makeClient(guild);
    const rebuilt = makeRebuilt([]);
    rebuilt.play = async () => {};
    const migrator = new NodeMigrator(
        client,
        async () => rebuilt,
        { info: () => {}, warn: () => {}, error: () => {} }
    );

    await migrator.rebuild(dispatcher, node);

    assert.ok(order.indexOf('position') >= 0);
    assert.equal(order[0], 'position');
    assert.ok(events.includes('teardown:true'));
});

test('a resume position sampled before the switch wins over the live position', async () => {
    const guild = makeGuild();
    let positionReads = 0;
    const { dispatcher, events } = makeDispatcher({
        resumePosition: 42_000,
        player: {
            node: { name: 'old-node' },
            get position() {
                positionReads += 1;
                return 8000;
            },
            track: {},
            setGlobalVolume: async () => {},
            seekTo: async value => events.push(`seek:${value}`),
            setPaused: async () => {},
        },
    });
    const { client } = makeClient(guild);
    const rebuilt = makeRebuilt(events);
    const migrator = new NodeMigrator(
        client,
        async () => rebuilt,
        { info: () => {}, warn: () => {}, error: () => {} }
    );

    await migrator.rebuild(dispatcher, node);

    assert.equal(positionReads, 0);
    assert.ok(events.includes('seek:42000'));
});

test('a failed spawn returns null and preserves the saved session', async () => {
    const guild = makeGuild();
    const { dispatcher, events } = makeDispatcher();
    const { client, events: clientEvents } = makeClient(guild);
    const migrator = new NodeMigrator(
        client,
        async () => {
            throw new Error('no node');
        },
        { info: () => {}, warn: () => {}, error: () => {} }
    );

    const result = await migrator.rebuild(dispatcher, node);

    assert.equal(result, null);
    assert.ok(events.includes('teardown:true'));
    assert.equal(clientEvents.includes('playerCreate'), false);
});

test('a second rebuild for the same guild does not move it twice', async () => {
    const guild = makeGuild();
    const { dispatcher } = makeDispatcher();
    const { client } = makeClient(guild);
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    const rebuilt = makeRebuilt([]);
    rebuilt.play = async () => {};
    const migrator = new NodeMigrator(
        client,
        async () => {
            await gate;
            return rebuilt;
        },
        { info: () => {}, warn: () => {}, error: () => {} }
    );

    const first = migrator.rebuild(dispatcher, node);
    const second = await migrator.rebuild(dispatcher, node);
    release();
    const firstResult = await first;

    assert.equal(second, null);
    assert.equal(firstResult, rebuilt);
});

test('a skipped queue rebuild does not duplicate the head track', async () => {
    const guild = makeGuild();
    const { dispatcher } = makeDispatcher({ current: null });
    const { client } = makeClient(guild);
    const rebuilt = makeRebuilt([]);
    rebuilt.play = async () => {};
    const migrator = new NodeMigrator(
        client,
        async () => rebuilt,
        { info: () => {}, warn: () => {}, error: () => {} }
    );

    await migrator.rebuild(dispatcher, node);

    assert.deepEqual(rebuilt.queue.map(track => track.info.title), ['next']);
});

test('rebuild waits for the migrated volume before starting playback', async () => {
    const guild = makeGuild();
    const { dispatcher, events } = makeDispatcher();
    const { client, events: clientEvents } = makeClient(guild);
    const rebuilt = makeRebuilt(events);
    let releaseVolume;
    const volumeApplied = new Promise(resolve => {
        releaseVolume = resolve;
    });
    rebuilt.player.setGlobalVolume = async value => {
        await volumeApplied;
        events.push(`volume:${value}`);
    };
    rebuilt.play = async () => events.push('play');
    const migrator = new NodeMigrator(
        client,
        async () => rebuilt,
        { info: () => {}, warn: () => {}, error: () => {} }
    );

    const migrating = migrator.rebuild(dispatcher, node);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(events.includes('play'), false, 'play must wait for the volume write');
    assert.equal(clientEvents.includes('playerCreate'), false);

    releaseVolume();
    await migrating;

    assert.deepEqual(events.filter(event => event === 'volume:100' || event === 'play'), [
        'volume:100',
        'play',
    ]);
    assert.ok(clientEvents.includes('playerCreate'));
});

test('a replacement that fails mid-restore is torn down and the session kept', async () => {
    const guild = makeGuild();
    const { dispatcher } = makeDispatcher();
    const { client } = makeClient(guild);
    const rebuilt = makeRebuilt([]);
    rebuilt.play = async () => {
        throw new Error('lavalink rejected the resumed track');
    };
    const cleaned = [];
    rebuilt.destroy = preserve => cleaned.push(preserve);
    const errors = [];
    const migrator = new NodeMigrator(
        client,
        async () => rebuilt,
        { info: () => {}, warn: () => {}, error: message => errors.push(message) }
    );

    const result = await migrator.rebuild(dispatcher, node);

    assert.equal(result, null);
    assert.deepEqual(cleaned, [true], 'the half-built player is destroyed with the session kept');
    assert.ok(errors.some(message => /saved session kept/.test(message)));
});
