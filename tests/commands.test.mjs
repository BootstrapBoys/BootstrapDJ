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
    const slow = ['music/Play', 'music/PlayNext', 'music/Search', 'playlist/Load', 'playlist/Add'];
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
