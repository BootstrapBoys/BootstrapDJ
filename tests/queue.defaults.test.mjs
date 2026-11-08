import assert from 'node:assert/strict';
import test from 'node:test';

import { Queue } from '../dist/core/Queue.js';

function makeQueueClient(settings = {}) {
    const calls = { volumes: [], created: [], leases: 0 };
    const voice = { id: 'voice-1', type: 2 };
    const text = { id: 'text-1', type: 0 };
    const player = {
        position: 0,
        volume: 100,
        paused: false,
        track: null,
        on() {
            return this;
        },
        setGlobalVolume: async value => calls.volumes.push(value),
        setPaused: async () => {},
        stopTrack: async () => {},
        seekTo: async () => {},
        playTrack: async () => {},
    };
    const node = { name: 'node-1', sessionId: 'session-1' };
    const client = {
        user: { id: 'bot', username: 'Bootstrap' },
        config: { botName: 'Bootstrap' },
        queue: null,
        logger: {
            info: message => calls.created.push(message),
            warn: () => {},
            error: () => {},
            debug: () => {},
        },
        db: {
            getGuildSettings: async () => settings,
            claimSessionLease: async () => {
                calls.leases += 1;
                return true;
            },
        },
        shoukaku: {
            nodes: new Map(),
            options: { nodeResolver: () => node },
            joinVoiceChannel: async () => player,
            emitPlayerEvent: () => {},
        },
        utils: { updateStatus: () => {} },
        guilds: { cache: new Map() },
    };
    const guild = {
        id: 'guild-1',
        shard: { id: 0 },
        channels: { cache: new Map([[voice.id, voice], [text.id, text]]) },
    };
    const queue = new Queue(client);
    client.queue = queue;
    return { queue, client, guild, voice, text, player, calls };
}

test('a new player applies the persisted default volume after a stop/leave', async () => {
    const harness = makeQueueClient({ defaultvolume: '25' });

    const dispatcher = await harness.queue.create(harness.guild, harness.voice, harness.text);

    assert.equal(harness.queue.get('guild-1'), dispatcher);
    assert.deepEqual(harness.calls.volumes, [25]);
    assert.equal(harness.calls.leases, 1);

    dispatcher.timers.clearAll();
});

test('default repeat and autoplay are applied to a new player', async () => {
    const harness = makeQueueClient({ defaultrepeat: 'queue', defaultautoplay: 'true' });

    const dispatcher = await harness.queue.create(harness.guild, harness.voice, harness.text);

    assert.equal(dispatcher.loop, 'queue');
    assert.equal(dispatcher.autoplay, true);

    dispatcher.timers.clearAll();
});

test('an invalid default volume is ignored', async () => {
    const harness = makeQueueClient({ defaultvolume: 'loud' });

    const dispatcher = await harness.queue.create(harness.guild, harness.voice, harness.text);

    assert.deepEqual(harness.calls.volumes, []);
    assert.equal(dispatcher.loop, 'off');

    dispatcher.timers.clearAll();
});
