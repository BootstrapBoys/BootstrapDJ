import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeWatchdog } from '../dist/plugin/plugins/reconnectNodes.js';

const CONNECTED = 1;
const DISCONNECTED = 4;

function makeDispatcher({ nodeName, current = null, queue = [] } = {}) {
    const dispatcher = {
        node: { name: nodeName },
        player: { node: { name: nodeName } },
        current,
        queue,
        isStale: false,
        destroy() {
            dispatcher.destroyed = true;
        },
    };
    return dispatcher;
}

function makeClient({ nodes, dispatchers = [], queueNode = null } = {}) {
    const removed = [];
    const migrated = [];
    const migratedFrom = [];
    const destroyed = [];
    const pool = new Map(nodes.map(node => [node.name, node]));
    const players = new Map(dispatchers.map((dispatcher, index) => [`g${index}`, dispatcher]));

    for (const dispatcher of dispatchers) {
        const original = dispatcher.destroy.bind(dispatcher);
        dispatcher.destroy = () => {
            destroyed.push(dispatcher);
            original();
            for (const [guildId, value] of players) {
                if (value === dispatcher) players.delete(guildId);
            }
        };
    }

    const client = {
        isReady: () => true,
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, success: () => {} },
        config: {
            lavalink: [{ name: 'primary', url: 'primary:2333' }],
            nodeFallback: false,
            nodeFallbackAfter: 180,
            publicNodeListUrl: 'https://nodes.example.test',
        },
        shoukaku: {
            nodes: pool,
            removeNode: name => {
                removed.push(name);
                pool.delete(name);
            },
            addNode: () => {},
        },
        queue: {
            values: () => players.values(),
            hasNode: queueNode !== null,
            node: queueNode ?? undefined,
            migrateToNode: async node => {
                migrated.push(node?.name ?? null);
                return 1;
            },
            migrateFromNode: async (from, node) => {
                migratedFrom.push([from, node?.name ?? null]);
                return 1;
            },
        },
    };

    return { client, removed, migrated, migratedFrom, destroyed, pool, players };
}

test('a shared public fallback is removed once no local player uses it', () => {
    const { client, removed } = makeClient({
        nodes: [
            { name: 'primary', state: CONNECTED, stats: { players: 4 } },
            { name: 'public-a', state: CONNECTED, stats: { players: 99 } },
        ],
    });
    const watchdog = new NodeWatchdog(client);
    watchdog.fallbackName = 'public-a';

    watchdog.tick();

    // Remote stats belong to every bot on the node; they must not pin our copy.
    assert.deepEqual(removed, ['public-a']);
    assert.equal(watchdog.fallbackName, null);
});

test('players on the fallback migrate to the primary before it is removed', async () => {
    const active = makeDispatcher({ nodeName: 'public-a', current: { info: { title: 'song' } } });
    const { client, removed, migratedFrom } = makeClient({
        nodes: [
            { name: 'primary', state: CONNECTED },
            { name: 'public-a', state: CONNECTED },
        ],
        dispatchers: [active],
    });
    const watchdog = new NodeWatchdog(client);
    watchdog.fallbackName = 'public-a';

    watchdog.tick();

    assert.deepEqual(migratedFrom, [['public-a', 'primary']]);
    assert.deepEqual(removed, []);

    // The migration rebinds the player; the next pass can drop the fallback.
    active.player.node = { name: 'primary' };
    active.node = { name: 'primary' };
    await new Promise(resolve => setImmediate(resolve));
    watchdog.tick();
    assert.deepEqual(removed, ['public-a']);
});

test('an idle player on the fallback is torn down before the node is removed', () => {
    const idle = makeDispatcher({ nodeName: 'public-a' });
    const { client, removed, destroyed } = makeClient({
        nodes: [
            { name: 'primary', state: CONNECTED },
            { name: 'public-a', state: CONNECTED },
        ],
        dispatchers: [idle],
    });
    const watchdog = new NodeWatchdog(client);
    watchdog.fallbackName = 'public-a';

    watchdog.tick();

    assert.equal(destroyed.length, 1);
    assert.deepEqual(removed, ['public-a']);
});

test('a dead fallback is drained through the primary, not dropped first', () => {
    const active = makeDispatcher({ nodeName: 'public-a', current: { info: { title: 'song' } } });
    const { client, removed, migratedFrom } = makeClient({
        nodes: [
            { name: 'primary', state: CONNECTED },
            { name: 'public-a', state: DISCONNECTED },
        ],
        dispatchers: [active],
    });
    const watchdog = new NodeWatchdog(client);
    watchdog.fallbackName = 'public-a';

    watchdog.tick();

    assert.deepEqual(migratedFrom, [['public-a', 'primary']]);
    assert.deepEqual(removed, [], 'removing first would strand the saved session');
});

test('stranded players migrate once per watchdog pass while the primary is down', () => {
    const stranded = makeDispatcher({ nodeName: 'primary', current: { info: { title: 'song' } } });
    stranded.isStale = true;
    const { client, migrated } = makeClient({
        nodes: [
            { name: 'primary', state: DISCONNECTED },
            { name: 'standby', state: CONNECTED },
        ],
        dispatchers: [stranded],
        queueNode: { name: 'standby' },
    });
    const watchdog = new NodeWatchdog(client);

    watchdog.tick();
    watchdog.tick();

    assert.deepEqual(migrated, ['standby']);
});
