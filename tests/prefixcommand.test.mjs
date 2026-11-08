import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchPrefixCommand } from '../dist/lib/PrefixCommand.js';

test('prefix matching selects the longest configured prefix', () => {
    assert.deepEqual(matchPrefixCommand('!!playnext song', ['!', '!!']), {
        prefix: '!!',
        name: 'playnext',
    });
    assert.deepEqual(matchPrefixCommand('?pn song', ['?']), { prefix: '?', name: 'pn' });
    assert.equal(matchPrefixCommand('song', ['!']), null);
});

test('prefix matching normalizes the command token', () => {
    assert.deepEqual(matchPrefixCommand('!PLAYNEXT song', ['!']), {
        prefix: '!',
        name: 'playnext',
    });
    assert.equal(matchPrefixCommand('! ', ['!']), null);
});
