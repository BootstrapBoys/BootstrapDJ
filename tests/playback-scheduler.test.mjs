import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlaybackScheduler } from '../dist/core/player/PlaybackScheduler.js';

function makePlayer(overrides = {}) {
    const player = {
        guildId: 'guild-1',
        exists: true,
        paused: false,
        current: {},
        queue: [],
        persists: 0,
        persist: async () => {
            player.persists += 1;
        },
        ...overrides,
    };
    return player;
}

test('the scheduler persists only when an active player is due', () => {
    const scheduler = new PlaybackScheduler();
    const player = makePlayer();
    scheduler.register(player);
    const start = Date.now();

    scheduler.tick(start + 9_999);
    assert.equal(player.persists, 0);
    scheduler.tick(start + 10_000);
    assert.equal(player.persists, 1);
    scheduler.tick(start + 10_001);
    assert.equal(player.persists, 1);

    scheduler.unregister(player.guildId, player);
});

test('the scheduler skips paused, empty and missing players', () => {
    const scheduler = new PlaybackScheduler();
    const paused = makePlayer({ guildId: 'paused', paused: true });
    const empty = makePlayer({ guildId: 'empty', current: null });
    const gone = makePlayer({ guildId: 'gone', exists: false });
    scheduler.register(paused);
    scheduler.register(empty);
    scheduler.register(gone);
    const now = Date.now() + 20_000;

    scheduler.tick(now);
    assert.equal(paused.persists, 0);
    assert.equal(empty.persists, 0);
    assert.equal(gone.persists, 0);

    scheduler.unregister(paused.guildId, paused);
    scheduler.unregister(empty.guildId, empty);
    scheduler.unregister(gone.guildId, gone);
});

test('replacing a player unregisters the old entry', () => {
    const scheduler = new PlaybackScheduler();
    const oldPlayer = makePlayer({ guildId: 'replace' });
    const newPlayer = makePlayer({ guildId: 'replace' });
    scheduler.register(oldPlayer);
    scheduler.register(newPlayer);

    scheduler.tick(Date.now() + 20_000);
    assert.equal(oldPlayer.persists, 0);
    assert.equal(newPlayer.persists, 1);

    scheduler.unregister('replace', oldPlayer);
    scheduler.tick(Date.now() + 40_000);
    assert.equal(newPlayer.persists, 2);
    scheduler.unregister('replace', newPlayer);
});
