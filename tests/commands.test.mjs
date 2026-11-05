import assert from 'node:assert/strict';
import { test } from 'node:test';

import Command from '../dist/structures/Command.js';

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

test('commands that do remote work before replying defer; fast ones do not', async () => {
    const slow = [
        'music/Play',
        'music/PlayNext',
        'music/Search',
        'music/Autoplay',
        'music/Lyrics',
        'music/PlayRecent',
        'music/PlaylistSearch',
        'music/PlaySelect',
        'playlist/Load',
        'playlist/Add',
        'playlist/RemoveSong',
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
        'config/AutoplayConfig',
        'config/Mappings',
        'config/Permissions',
        'config/Alias',
        'music/Backward',
        'music/EndTime',
        'music/Forward',
        'music/MassRemove',
        'music/MassMove',
        'music/NextUp',
        'music/Previous',
        'music/RecentlyPlayed',
        'music/RemoveCurrent',
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
        'music/StartTime',
        'music/Swap',
        'music/Top',
        'music/VoteSkip',
        'playlist/List',
        'playlist/Save',
        'playlist/RemoveSong',
        'music/FairPlay',
        'filters/Filters',
        'music/Move',
        'music/PlayRecent',
        'music/PlaySelect',
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


test('autoplay exposes three optional seed boxes', async () => {
    const AutoplayClass = (await import('../dist/commands/music/Autoplay.js')).default;
    const command = new AutoplayClass(fakeClient);
    const names = command.options.map(option => option.name);

    assert.deepEqual(names, ['seed', 'seed2', 'seed3']);
    assert.ok(command.options.every(option => option.required === false));
});