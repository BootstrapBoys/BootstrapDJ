import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { EmbedBuilder } from 'discord.js';

import {
    addSongBlacklistEntry,
    blacklistText,
    getSongBlacklist,
    getSongBlacklistEntry,
    parseSongBlacklist,
    purgeUserRequests,
    removeSongBlacklistEntry,
    SONGBLACKLIST_KEY,
    SONGBLACKLIST_MAX,
} from '../dist/lib/SongBlacklist.js';
import { checkTrack } from '../dist/lib/PlayLimits.js';
import Utility from '../dist/commands/tools/Utility.js';

const catalog = JSON.parse(
    readFileSync(new URL('../locales/en-US/longtail.json', import.meta.url), 'utf8')
).tools;
const limitCatalog = JSON.parse(
    readFileSync(new URL('../locales/en-US/longtail.json', import.meta.url), 'utf8')
).limits;

const USER_A = '123456789012345678';
const USER_B = '223456789012345678';
const USER_C = '323456789012345678';

function makeClient(initial = {}, player = null) {
    const settings = { ...initial };
    const queue = new Map(player ? [['g1', player]] : []);
    return {
        settings,
        db: {
            getGuildSettings: async () => ({ ...settings }),
            setGuildSetting: async (_guildId, key, value) => {
                settings[key] = value;
                return { guildId: 'g1', key, value };
            },
        },
        embed: () => new EmbedBuilder(),
        color: { main: 0x57f287, red: 0xed4245 },
        users: { fetch: async id => ({ id, bot: false, username: `user-${id}` }) },
        queue,
        commands: new Map(),
        application: null,
        config: {},
    };
}

function makeContext({ ownerId = '999999999999999999', authorId = USER_A } = {}) {
    const replies = [];
    return {
        replies,
        ctx: {
            isInteraction: false,
            interaction: null,
            guild: { id: 'g1', ownerId },
            author: { id: authorId, username: 'caller', bot: false },
            locale: 'en-US',
            sendMessage: async payload => {
                replies.push(payload);
                return payload;
            },
        },
    };
}

function track(requesterId, title = 'song') {
    return { info: { title, length: 60_000, isStream: false, requester: { id: requesterId } } };
}

test('parseSongBlacklist accepts JSON entries and legacy CSV ids', () => {
    const json = JSON.stringify([
        { id: USER_A, reason: 'spam', by: USER_B, at: '2026-01-01T00:00:00.000Z' },
        { id: USER_A, reason: 'duplicate' },
        { id: 'not-an-id' },
    ]);
    const parsed = parseSongBlacklist(json);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, USER_A);
    assert.equal(parsed[0].reason, 'spam');

    const legacy = parseSongBlacklist(`${USER_A}, ${USER_B}`);
    assert.deepEqual(
        legacy.map(entry => entry.id),
        [USER_A, USER_B]
    );
    assert.equal(parseSongBlacklist('{broken').length, 0);
    assert.equal(parseSongBlacklist(null).length, 0);
});

test('add, update and remove persist one entry per user', async () => {
    const client = makeClient();

    assert.equal(await addSongBlacklistEntry(client, 'g1', USER_A, USER_B, 'spam'), 'added');
    assert.equal(await getSongBlacklistEntry(client, 'g1', USER_A).then(e => e?.reason), 'spam');

    assert.equal(await addSongBlacklistEntry(client, 'g1', USER_A, USER_C, 'changed'), 'updated');
    const entries = await getSongBlacklist(client, 'g1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].reason, 'changed');
    assert.equal(entries[0].by, USER_C);

    assert.equal(await removeSongBlacklistEntry(client, 'g1', USER_A), true);
    assert.equal(await removeSongBlacklistEntry(client, 'g1', USER_A), false);
    assert.equal(await getSongBlacklistEntry(client, 'g1', USER_A), null);
});

test('the blacklist refuses new entries past its cap', async () => {
    const entries = Array.from({ length: SONGBLACKLIST_MAX }, (_value, index) => ({
        id: `4${String(index).padStart(17, '0')}`,
        reason: '',
        by: '',
        at: '',
    }));
    const client = makeClient({ [SONGBLACKLIST_KEY]: JSON.stringify(entries) });

    assert.equal(await addSongBlacklistEntry(client, 'g1', USER_A, USER_B), 'full');
    assert.equal((await getSongBlacklist(client, 'g1')).length, SONGBLACKLIST_MAX);
});

test('purgeUserRequests removes only queued tracks the user requested', async () => {
    let persisted = 0;
    const player = {
        queue: [track(USER_A, 'one'), track(USER_B, 'two'), track(USER_A, 'three')],
        persist: async () => {
            persisted += 1;
        },
    };

    const removed = await purgeUserRequests(player, USER_A);
    assert.equal(removed, 2);
    assert.deepEqual(
        player.queue.map(item => item.info.title),
        ['two']
    );
    assert.equal(persisted, 1);
    assert.equal(await purgeUserRequests(player, USER_C), 0);
});

test('checkTrack rejects a blacklisted requester before any limit', () => {
    const limits = {
        maxTrackLength: 0,
        minTrackLength: 0,
        maxQueue: 0,
        maxUserTracks: 0,
        maxUserTracksLength: 0,
        maxUserQueue: 0,
        maxPlaylistTracks: 0,
        maxPlaylistLength: 0,
        blacklisted: new Set([USER_A]),
    };
    const player = { queue: [], current: null };

    assert.equal(checkTrack(player, track(USER_A), USER_A, limits), limitCatalog.blacklisted);
    assert.equal(checkTrack(player, track(USER_B), USER_B, limits), null);

    const withReason = parseSongBlacklist(
        JSON.stringify([{ id: USER_A, reason: 'repeated spam' }])
    )[0];
    assert.equal(
        blacklistText('en-US', withReason),
        limitCatalog.blacklistedWithReason.replace('{{reason}}', 'repeated spam')
    );
});

test('only the server owner can manage the blacklist', async () => {
    const client = makeClient();
    const command = new Utility(client);
    const { ctx, replies } = makeContext({ ownerId: USER_B, authorId: USER_A });

    await command.run(client, ctx, ['songblacklist', `<@${USER_A}>`]);

    assert.equal(replies.length, 1);
    assert.equal(replies[0].embeds[0].data.description, catalog.utilityBlacklistOwnerOnly);
    assert.equal(client.settings[SONGBLACKLIST_KEY], undefined);
});

test('blacklisting purges that user’s queued tracks and remove restores them', async () => {
    const player = {
        queue: [track(USER_A), track(USER_B)],
        persist: async () => {},
    };
    const client = makeClient({}, player);
    const command = new Utility(client);
    const { ctx, replies } = makeContext({ ownerId: USER_A, authorId: USER_A });

    await command.run(client, ctx, ['songblacklist', `<@${USER_B}>`, 'keeps spamming']);

    const stored = await getSongBlacklistEntry(client, 'g1', USER_B);
    assert.equal(stored?.reason, 'keeps spamming');
    assert.equal(player.queue.length, 1);
    assert.equal(player.queue[0].info.requester.id, USER_A);
    const added = replies.at(-1).embeds[0].data.description;
    assert.match(added, /Blacklisted/);
    assert.match(added, /Removed 1 of their queued tracks/);

    await command.run(client, ctx, ['songblacklist', 'remove', `<@${USER_B}>`]);
    assert.equal(await getSongBlacklistEntry(client, 'g1', USER_B), null);
    assert.equal(
        replies.at(-1).embeds[0].data.description,
        catalog.utilityBlacklistRemoved.replace('{{user}}', `<@${USER_B}>`)
    );
});

test('listing shows entries and an empty blacklist reads clean', async () => {
    const client = makeClient();
    const command = new Utility(client);
    const { ctx, replies } = makeContext({ ownerId: USER_A, authorId: USER_A });

    await command.run(client, ctx, ['songblacklist']);
    assert.equal(replies.at(-1).embeds[0].data.description, catalog.utilityBlacklistEmpty);

    await client.db.setGuildSetting(
        'g1',
        SONGBLACKLIST_KEY,
        JSON.stringify([{ id: USER_B, reason: 'spam' }])
    );
    await command.run(client, ctx, ['songblacklist', 'list']);
    const embed = replies.at(-1).embeds[0].data;
    assert.equal(embed.title, catalog.utilityBlacklistTitle);
    assert.match(embed.description, new RegExp(USER_B));
    assert.match(embed.description, /spam/);
});
