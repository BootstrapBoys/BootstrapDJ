import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSetupRequest } from '../dist/utils/SetupRequest.js';

const aliases = name => (name === 'pn' ? 'playnext' : undefined);

test('setup requests recognise playnext and its alias', () => {
    assert.deepEqual(parseSetupRequest('!playnext test two', ['!'], aliases), {
        query: 'test two',
        next: true,
    });
    assert.deepEqual(parseSetupRequest('!pn test two', ['!'], aliases), {
        query: 'test two',
        next: true,
    });
});

test('ordinary setup requests stay append-only queries', () => {
    assert.deepEqual(parseSetupRequest('test two', ['!'], aliases), {
        query: 'test two',
        next: false,
    });
    assert.deepEqual(parseSetupRequest('!play test two', ['!'], aliases), {
        query: '!play test two',
        next: false,
    });
});

test('custom and longer prefixes are handled', () => {
    assert.deepEqual(parseSetupRequest('?playnext a', ['?'], aliases), {
        query: 'a',
        next: true,
    });
    assert.deepEqual(parseSetupRequest('!!playnext a', ['!', '!!'], aliases), {
        query: 'a',
        next: true,
    });
});
