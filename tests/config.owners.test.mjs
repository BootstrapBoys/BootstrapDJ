import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOwnerIds } from '../dist/config.js';
import { isOwner } from '../dist/lib/CommandGate.js';

test('OWNER_IDS parses a JSON array of snowflake strings and dedupes it', () => {
    assert.deepEqual(parseOwnerIds('["123456789012345678","234567890123456789"]'), [
        '123456789012345678',
        '234567890123456789',
    ]);
    assert.deepEqual(parseOwnerIds('["123456789012345678","123456789012345678"]'), [
        '123456789012345678',
    ]);
    assert.deepEqual(parseOwnerIds('[" 123456789012345678 "]'), ['123456789012345678']);
});

test('an absent OWNER_IDS means no owners', () => {
    assert.deepEqual(parseOwnerIds(undefined), []);
    assert.deepEqual(parseOwnerIds(''), []);
    assert.deepEqual(parseOwnerIds('   '), []);
});

test('malformed OWNER_IDS fails closed instead of yielding a castable value', () => {
    for (const raw of [
        'null',
        '"123456789012345678"',
        '{"0":"123456789012345678"}',
        '123456789012345678',
        '[]]',
        '123456789012345678,234567890123456789',
    ]) {
        assert.throws(() => parseOwnerIds(raw), /OWNER_IDS/, `accepted ${raw}`);
    }
});

test('OWNER_IDS rejects non-string and non-snowflake entries', () => {
    assert.throws(() => parseOwnerIds('[123456789012345678]'), /entry 0/);
    assert.throws(() => parseOwnerIds('["dev"]'), /entry 0/);
    assert.throws(() => parseOwnerIds('["123456789012345678","not-an-id"]'), /entry 1/);
    assert.throws(() => parseOwnerIds('[null]'), /entry 0/);
});

test('owner checks never substring-match and fail closed on an empty list', () => {
    assert.equal(isOwner('123456789012345678', ['123456789012345678']), true);
    assert.equal(isOwner('12345678901234567', ['123456789012345678']), false);
    assert.equal(isOwner('dev', ['dev']), true);
    assert.equal(isOwner('dev', []), false);
    assert.equal(isOwner('dev', null), false);
    assert.equal(isOwner('dev', undefined), false);
});
