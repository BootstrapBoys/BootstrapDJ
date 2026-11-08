import assert from 'node:assert/strict';
import test from 'node:test';

import { Collection, EmbedBuilder, GuildMember } from 'discord.js';
import { LoadType } from 'shoukaku';

import Add from '../dist/commands/manage/Add.js';
import CollectionCommand from '../dist/commands/manage/Collection.js';
import Mappings from '../dist/commands/manage/Mappings.js';
import Prefix from '../dist/commands/manage/Prefix.js';
import Move from '../dist/commands/music/Move.js';
import Profile from '../dist/commands/tools/Profile.js';
import Requested from '../dist/commands/music/Requested.js';

const fakeClient = { config: {}, logger: {} };
const embedClient = () => ({
    embed: () => new EmbedBuilder(),
    color: { red: 0xff0000, green: 0x00ff00, main: 0x2f3136 },
    config: { prefixSearchEngine: 'ytsearch', searchEngine: 'ytsearch' },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
});

function rawTrack(title) {
    return {
        encoded: `encoded-${title}`,
        info: {
            identifier: title,
            isSeekable: true,
            author: 'Artist',
            length: 1000,
            isStream: false,
            position: 0,
            title,
            uri: `https://music.example/${title}`,
            sourceName: 'deezer',
        },
    };
}

function member() {
    const value = Object.create(GuildMember.prototype);
    Object.defineProperty(value, 'permissions', {
        value: { has: () => true },
        configurable: true,
    });
    Object.defineProperty(value, 'roles', {
        value: { cache: new Map() },
        configurable: true,
    });
    return value;
}

function prefixCtx(args, extra = {}) {
    return {
        isInteraction: false,
        interaction: null,
        args,
        guild: { id: 'guild' },
        author: { id: 'user', username: 'User' },
        member: member(),
        message: { mentions: { users: new Map() } },
        sendMessage: async payload => payload,
        ...extra,
    };
}

test('move accepts the word "to" between the two positions', async () => {
    const queue = ['a', 'b', 'c'].map(title => ({ info: { title } }));
    const player = {
        current: { info: { title: 'current' } },
        queue,
        persist: async () => {},
    };
    const client = {
        ...embedClient(),
        queue: { get: () => player },
    };
    const ctx = prefixCtx(['3', 'to', '1']);

    await new Move(client).run(client, ctx, ctx.args);

    assert.deepEqual(
        queue.map(track => track.info.title),
        ['c', 'a', 'b']
    );
});

test('requested uses the mentioned user on the prefix path', async () => {
    const target = { id: 'target', username: 'Target' };
    const player = {
        current: { info: { title: 'current' } },
        queue: [
            { info: { title: 'mine', requester: { id: 'user' }, uri: 'https://x/mine' } },
            { info: { title: 'theirs', requester: { id: 'target' }, uri: 'https://x/theirs' } },
        ],
    };
    const client = { ...embedClient(), queue: { get: () => player } };
    let sent;
    const ctx = prefixCtx(['<@target>'], {
        message: { mentions: { users: new Collection([[target.id, target]]) } },
        sendMessage: async payload => {
            sent = payload;
            return payload;
        },
    });

    await new Requested(client).run(client, ctx, ctx.args);

    assert.match(sent.embeds[0].data.title, /Target/);
    assert.match(sent.embeds[0].data.description, /theirs/);
    assert.doesNotMatch(sent.embeds[0].data.description, /mine/);
});

test('add treats every word after the playlist name as the search query', async () => {
    let query = null;
    let added = null;
    const client = {
        ...embedClient(),
        db: {
            getPLaylist: async () => ({ name: 'mix' }),
            addSong: async (_author, _name, track) => {
                added = track.info.title;
                return true;
            },
        },
        queue: {
            search: async value => {
                query = value;
                return { loadType: LoadType.TRACK, data: rawTrack('never gonna') };
            },
        },
    };
    const ctx = prefixCtx(['mix', 'never', 'gonna', 'give']);

    await new Add(client).run(client, ctx, ctx.args);

    assert.equal(query, 'never gonna give');
    assert.equal(added, 'never gonna');
});

test('profile set bio keeps the words after the key', async () => {
    let saved = null;
    const client = {
        ...embedClient(),
        db: {
            setProfile: async (_authorId, data) => {
                saved = data;
            },
        },
    };
    const ctx = prefixCtx(['set', 'bio', 'Music', 'first']);

    await new Profile(client).run(client, ctx, ctx.args);

    assert.equal(saved.bio, 'Music first');
});

test('mappings add keeps a multi-word expansion and parses a trailing scope', async () => {
    let saved = null;
    const client = {
        ...embedClient(),
        commands: new Map([['play', {}]]),
        db: {
            setCommandMapping: async (_guildId, scope, userId, trigger, expansion) => {
                saved = { scope, userId, trigger, expansion };
            },
        },
    };
    const command = new Mappings(fakeClient);
    const ctx = prefixCtx(['add', 'rickroll', 'play', 'never', 'gonna', 'user']);

    await command.run(client, ctx);

    assert.deepEqual(saved, {
        scope: 'user',
        userId: 'user',
        trigger: 'rickroll',
        expansion: 'play never gonna',
    });
});

test('playlist remove reads the index directly after the name', async () => {
    let removed = null;
    const client = {
        ...embedClient(),
        db: {
            getPLaylist: async () => ({ name: 'mix' }),
            removeSongAt: async (_authorId, name, index) => {
                removed = { name, index };
                return true;
            },
        },
    };
    const ctx = prefixCtx(['remove', 'mix', '3']);

    await new CollectionCommand(fakeClient).run(client, ctx, ctx.args);

    assert.deepEqual(removed, { name: 'mix', index: 3 });
});

test('playlist rename reads the target directly after the source name', async () => {
    const calls = { created: null, deleted: null };
    const exists = new Map([
        ['old', { name: 'old' }],
        ['new', null],
    ]);
    const client = {
        ...embedClient(),
        db: {
            getPLaylist: async (_authorId, name) => exists.get(name) ?? null,
            getSong: async () => [],
            createPlaylist: async (_authorId, name) => {
                calls.created = name;
            },
            deletePlaylist: async (_authorId, name) => {
                calls.deleted = name;
                return true;
            },
        },
    };
    const ctx = prefixCtx(['rename', 'old', 'new']);

    await new CollectionCommand(fakeClient).run(client, ctx, ctx.args);

    assert.deepEqual(calls, { created: 'new', deleted: 'old' });
});

test('playlist add keeps every word after the name as the search query', async () => {
    let query = null;
    let added = 0;
    const client = {
        ...embedClient(),
        db: {
            getPLaylist: async () => ({ name: 'mix' }),
            addSong: async () => {
                added += 1;
                return true;
            },
        },
        queue: {
            search: async value => {
                query = value;
                return { loadType: LoadType.TRACK, data: rawTrack('track') };
            },
        },
    };
    const ctx = prefixCtx(['add', 'mix', 'never', 'gonna', 'give']);

    await new CollectionCommand(fakeClient).run(client, ctx, ctx.args);

    assert.equal(query, 'never gonna give');
    assert.equal(added, 1);
});

test('an unknown prefix subcommand is reported instead of silently ignored', async () => {
    let sent;
    const client = {
        ...embedClient(),
        config: { prefix: '!' },
        db: { get: async () => ({ prefix: '!' }) },
    };
    const ctx = prefixCtx(['bogus'], {
        sendMessage: async payload => {
            sent = payload;
            return payload;
        },
    });

    await new Prefix(fakeClient).run(client, ctx, ctx.args);

    assert.match(sent.embeds[0].data.description, /prefix set/);
});
