import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import Command from '../dist/core/Command.js';

// Commands only read their client in run(), never in the constructor, so a
// bare object is enough to exercise option plumbing.
const fakeClient = { config: {}, logger: {} };

const baseOptions = overrides => ({
    name: 'test',
    description: { content: 'test', usage: 'test', examples: ['test'] },
    category: 'general',
    ...overrides,
});

test('defer defaults to false', () => {
    const command = new Command(fakeClient, baseOptions());

    assert.equal(command.defer, false);
});

test('defer can be opted into', () => {
    const command = new Command(fakeClient, baseOptions({ defer: true }));

    assert.equal(command.defer, true);
});

test('command names and aliases do not collide across the tree', async () => {
    const root = path.join(process.cwd(), 'dist', 'commands');
    const owners = new Map();
    for (const dir of fs.readdirSync(root)) {
        const folder = path.join(root, dir);
        if (!fs.statSync(folder).isDirectory()) continue;
        for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.js'))) {
            const CommandClass = (await import(`../dist/commands/${dir}/${file}`)).default;
            const command = new CommandClass(fakeClient);
            const source = `${dir}/${file}`;
            for (const token of [command.name, ...command.aliases]) {
                const key = token.toLowerCase();
                const previous = owners.get(key);
                if (previous && previous !== source) {
                    assert.fail(`${source} duplicates command/alias \`${key}\` from ${previous}`);
                }
                owners.set(key, source);
            }
        }
    }
});

test('commands that do remote work before replying defer; fast ones do not', async () => {
    const slow = [
        'music/Play',
        'music/PlayNext',
        'music/PlayLocal',
        'music/Autoplay',
        'music/Lyrics',
        'music/PlayLeave',
        'music/PlayRecent',
        'music/Radio',
        'music/PlaylistSearch',
        'music/PlaySelect',
        'manage/Load',
        'manage/Add',
        'manage/RemoveSong',
    ];
    const fast = ['music/Pause', 'music/Skip', 'music/Queue'];

    for (const path of slow) {
        const CommandClass = (await import(`../dist/commands/${path}.js`)).default;
        assert.equal(new CommandClass(fakeClient).defer, true, `${path} must defer`);
    }
    for (const path of fast) {
        const CommandClass = (await import(`../dist/commands/${path}.js`)).default;
        assert.equal(new CommandClass(fakeClient).defer, false, `${path} must not defer`);
    }
});

test('the new feature commands are registered and keep ephemeral defaults', async () => {
    for (const path of [
        'manage/AutoplayConfig',
        'owner/Guild',
        'manage/Mappings',
        'manage/Permissions',
        'manage/Language',
        'manage/Alias',
        'music/Backward',
        'music/EndTime',
        'music/Forward',
        'music/MassRemove',
        'music/MassMove',
        'music/Previous',
        'music/RecentlyPlayed',
        'music/RemoveDuplicates',
        'music/RemoveAbsent',
        'music/RemoveKeyword',
        'music/RemoveLast',
        'music/RemoveUser',
        'music/Reverse',
        'music/SessionStats',
        'music/ShuffleRepeat',
        'music/SelectRandom',
        'music/Sort',
        'music/Swap',
        'music/Top',
        'music/VoteSkip',
        'manage/List',
        'manage/Save',
        'manage/RemoveSong',
        'music/FairPlay',
        'filters/Filters',
        'filters/Filter',
        'music/Move',
        'music/PlayRecent',
        'music/PlaySelect',
        'music/PlayLocal',
        'filters/Rate',
        'music/Replay',
        'music/Lyrics',
    ]) {
        const CommandClass = (await import(`../dist/commands/${path}.js`)).default;
        const command = new CommandClass(fakeClient);
        assert.equal(command.ephemeral, true, `${path} must default to ephemeral`);
    }
});

test('slash replies default to ephemeral; queue and nowplaying stay public', async () => {
    const generic = new Command(fakeClient, baseOptions());
    assert.equal(generic.ephemeral, true);

    for (const path of ['music/Queue', 'music/Nowplaying']) {
        const CommandClass = (await import(`../dist/commands/${path}.js`)).default;
        assert.equal(new CommandClass(fakeClient).ephemeral, false, `${path} must stay public`);
    }
});

test('collection exposes the playlist actions without exceeding Discord choice limits', async () => {
    const CollectionClass = (await import('../dist/commands/manage/Collection.js')).default;
    const command = new CollectionClass(fakeClient);
    const action = command.options[0];
    const choices = action.choices?.map(choice => choice.value) ?? [];

    assert.ok(choices.includes('save'), 'collection must cover saving the current queue');
    assert.ok(choices.includes('removesong'), 'collection must cover removing a song by search');
    assert.ok(choices.includes('export'), 'collection must expose JSON export');
    assert.ok(choices.length <= 25, 'Discord caps one option at 25 choices');
});

test('the filter entry point enforces the same management permission as its children', async () => {
    const FilterClass = (await import('../dist/commands/filters/Filter.js')).default;
    const command = new FilterClass(fakeClient);
    assert.ok(command.permissions.user.includes('ManageGuild'));
});

test('autoplay exposes three optional seed boxes', async () => {
    const AutoplayClass = (await import('../dist/commands/music/Autoplay.js')).default;
    const command = new AutoplayClass(fakeClient);
    const names = command.options.map(option => option.name);

    assert.deepEqual(names, ['seed', 'seed2', 'seed3']);
    assert.ok(command.options.every(option => option.required === false));
});
test('guild inspector is owner-only and slash-visible', async () => {
    const GuildClass = (await import('../dist/commands/owner/Guild.js')).default;
    const command = new GuildClass(fakeClient);
    assert.equal(command.permissions.dev, true);
    assert.equal(command.slashCommand, true);
    assert.equal(command.ephemeral, true);
    assert.equal(command.options[0].name, 'guild');
    assert.equal(command.options[0].autocomplete, true);
});

test('setup requires both ManageGuild and ManageRoles', async () => {
    const SetupClass = (await import('../dist/commands/manage/Setup.js')).default;
    const command = new SetupClass(fakeClient);

    assert.ok(command.permissions.user.includes('ManageGuild'));
    assert.ok(command.permissions.user.includes('ManageRoles'));
});
