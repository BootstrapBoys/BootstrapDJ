import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits } from 'discord.js';

import {
    dashboardFilter,
    dashboardGuilds,
    dashboardPlayerAction,
    guildAccessFor,
    playerSnapshot,
} from '../dist/dashboard/shardApi.js';

function member(id, permissions = [], roles = []) {
    return {
        id,
        permissions: { has: permission => permissions.includes(permission) },
        roles: { cache: new Map(roles.map(roleId => [roleId, { id: roleId }])) },
    };
}

function guild(id, ownerId, members = []) {
    const cache = new Map(members.map(entry => [entry.id, entry]));
    return {
        id,
        name: `Guild ${id}`,
        ownerId,
        members: {
            cache,
            fetch: async userId => cache.get(userId) ?? null,
        },
    };
}

function client(guilds, roles = []) {
    return {
        guilds: { cache: new Map(guilds.map(entry => [entry.id, entry])) },
        db: { getRoles: async () => roles },
        queue: new Map(),
    };
}

test('guildAccessFor treats token mode as full access', async () => {
    const owner = member('1');
    const result = await guildAccessFor(client([guild('g1', '1', [owner])]), null, 'g1');
    assert.equal(result.found, true);
    assert.equal(result.access.member, true);
    assert.equal(result.access.settings, true);
});

test('guildAccessFor grants controls for a DJ role but not settings', async () => {
    const dj = member('2', [], ['dj']);
    const c = client([guild('g1', '1', [dj])], [{ roleId: 'dj' }]);
    const result = await guildAccessFor(c, '2', 'g1');
    assert.equal(result.access.member, true);
    assert.equal(result.access.controls, true);
    assert.equal(result.access.settings, false);
});

test('guildAccessFor grants settings to Manage Server', async () => {
    const manager = member('2', [PermissionFlagsBits.ManageGuild]);
    const c = client([guild('g1', '1', [manager])]);
    const result = await guildAccessFor(c, '2', 'g1');
    assert.equal(result.access.admin, true);
    assert.equal(result.access.settings, true);
});

test('guildAccessFor rejects an unknown guild', async () => {
    const result = await guildAccessFor(client([]), '2', 'missing');
    assert.equal(result.found, false);
    assert.equal(result.access.member, false);
});

test('dashboardGuilds filters to guilds the OAuth user belongs to', async () => {
    const c = client([guild('g1', '1', [member('2')]), guild('g2', '3', [member('4')])]);
    const rows = await dashboardGuilds(c, '2');
    assert.deepEqual(
        rows.map(row => row.id),
        ['g1']
    );
});

test('playerSnapshot returns the fields the dashboard needs', () => {
    const player = {
        current: { info: { title: 'Song', author: 'Artist', length: 1234 } },
        player: { position: 42 },
        queue: [{ info: { title: 'Next', author: 'Other', length: 2000, isStream: false } }],
        volume: 80,
        paused: false,
        loop: 'off',
        autoplay: true,
        filters: ['bassboost'],
        filterValues: { bassboost: 0.5 },
    };
    assert.deepEqual(playerSnapshot(player), {
        title: 'Song',
        author: 'Artist',
        duration: 1234,
        position: 42,
        queueLength: 1,
        upcoming: [{ position: 1, title: 'Next', author: 'Other', duration: 2000 }],
        volume: 80,
        paused: false,
        loop: 'off',
        autoplay: true,
        activeFilters: ['bassboost'],
        filterValues: { bassboost: 0.5 },
    });
});

test('dashboardFilter reports a missing player instead of throwing', () => {
    const result = dashboardFilter(client([]), 'g1', 'bassboost', true, 0.5);
    assert.deepEqual(result, {
        found: false,
        active: [],
        status: 404,
        error: 'No active player',
    });
});

test('dashboardFilter applies a filter on the owning player', () => {
    const c = client([]);
    c.queue.set('g1', {
        filters: [],
        filterValues: {},
        player: { setRotation: () => {} },
    });
    const enabled = dashboardFilter(c, 'g1', '8d', true);
    assert.equal(enabled.found, true);
    assert.deepEqual(enabled.active, ['8D']);
    const disabled = dashboardFilter(c, 'g1', '8d', false);
    assert.deepEqual(disabled.active, []);
});

test('dashboardPlayerAction seeks to a valid position', async () => {
    let sought = null;
    const c = client([]);
    c.queue.set('g1', {
        current: { info: { length: 10000 } },
        seek: value => {
            sought = value;
        },
    });
    const result = await dashboardPlayerAction(c, 'g1', 'seek', 4321);
    assert.equal(result.ok, true);
    assert.equal(sought, 4321);
});

test('all dashboard player actions map to the expected Dispatcher calls', async () => {
    const calls = [];
    const player = {
        current: { info: { length: 30000 } },
        queue: [{}, {}],
        paused: false,
        loop: 'off',
        volume: 50,
        player: {
            setGlobalVolume: async value => {
                await new Promise(resolve => setTimeout(resolve, 10));
                player.volume = value;
                calls.push(['volume', value]);
            },
        },
        pause: () => calls.push(['pause']),
        skip: async value => calls.push(['skip', value]),
        previousTrack: () => calls.push(['previous']),
        stop: () => calls.push(['stop']),
        setShuffle: () => calls.push(['shuffle']),
        persist: async () => calls.push(['persist']),
        setLoop: value => {
            player.loop = value;
            calls.push(['loop', value]);
        },
        seek: value => calls.push(['seek', value]),
    };
    const c = client([]);
    c.queue.set('g1', player);
    const expected = [
        ['toggle', undefined],
        ['next', undefined],
        ['previous', undefined],
        ['stop', undefined],
        ['shuffle', undefined],
        ['loop', undefined],
        ['jump', 2],
        ['seek', 12000],
        ['volume', 75],
    ];
    for (const [action, value] of expected) {
        const result = await dashboardPlayerAction(c, 'g1', action, value);
        assert.equal(result.ok, true, action);
    }
    assert.deepEqual(calls, [
        ['pause'],
        ['skip', undefined],
        ['previous'],
        ['stop'],
        ['shuffle'],
        ['persist'],
        ['loop', 'repeat'],
        ['skip', 2],
        ['seek', 12000],
        ['volume', 75],
    ]);
    assert.equal(player.volume, 75);
});

test('dashboardPlayerAction rejects invalid seek and jump values', async () => {
    const c = client([]);
    c.queue.set('g1', {
        current: { info: { length: 10000 } },
        queue: [{}],
        seek: () => {},
        skip: async () => {},
    });
    assert.equal((await dashboardPlayerAction(c, 'g1', 'seek', -1)).ok, false);
    assert.equal((await dashboardPlayerAction(c, 'g1', 'seek', 10001)).ok, false);
    assert.equal((await dashboardPlayerAction(c, 'g1', 'jump', 0)).ok, false);
    assert.equal((await dashboardPlayerAction(c, 'g1', 'jump', 2)).ok, false);
});
