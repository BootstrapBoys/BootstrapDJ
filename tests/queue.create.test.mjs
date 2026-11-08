import assert from 'node:assert/strict';
import test from 'node:test';

import { Queue } from '../dist/core/Queue.js';

const node = { name: 'test-node', sessionId: 'session-1' };

function makePlayer() {
    return {
        on() {
            return this;
        },
        volume: 100,
        position: 0,
        setGlobalVolume: async () => {},
    };
}

function makeClient() {
    const state = { joins: 0, players: [] };
    const client = {
        config: { botName: 'TestBot' },
        user: { id: 'bot', username: 'TestBot' },
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        db: {
            getGuildSettings: async () => ({}),
            claimSessionLease: async () => true,
        },
        shoukaku: {
            players: new Map(),
            joinVoiceChannel: async () => {
                state.joins += 1;
                const player = makePlayer();
                state.players.push(player);
                return player;
            },
            emitPlayerEvent: () => {},
        },
    };
    return { client, state };
}

function makeGuild() {
    return { id: 'guild-1', shard: { id: 0 }, channels: { cache: new Map() } };
}

async function seedPlayer(queue) {
    return await queue.create(makeGuild(), { id: 'voice-1' }, { id: 'text-1' }, node);
}

test('concurrent first-time creates coalesce into one spawn', async () => {
    const { client, state } = makeClient();
    const queue = new Queue(client);

    const [first, second] = await Promise.all([seedPlayer(queue), seedPlayer(queue)]);

    assert.equal(state.joins, 1);
    assert.equal(first, second);
    assert.equal(queue.get('guild-1'), first);
});

test('create during a rebuild returns the replacement, never the dying player', async () => {
    const { client } = makeClient();
    const queue = new Queue(client);
    const guild = makeGuild();
    const voice = { id: 'voice-1' };
    const text = { id: 'text-1' };

    const dying = await seedPlayer(queue);
    Object.defineProperty(dying, 'isStale', { configurable: true, value: true });

    const replacement = { guildId: 'guild-1', queue: [], current: null };
    let rebuilds = 0;
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    queue.migrator.rebuild = async () => {
        rebuilds += 1;
        await gate;
        queue.set('guild-1', replacement);
        return replacement;
    };

    const first = queue.create(guild, voice, text, node);
    const second = queue.create(guild, voice, text, node);
    await new Promise(resolve => setImmediate(resolve));
    release();

    const results = await Promise.all([first, second]);

    assert.equal(rebuilds, 1, 'the migration must run once');
    assert.equal(results[0], replacement);
    assert.equal(results[1], replacement);
    assert.equal(queue.get('guild-1'), replacement);
});
