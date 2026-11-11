import assert from 'node:assert/strict';
import test from 'node:test';

import { maxAudioStreamsPerUser } from '../dist/dashboard/limits.js';

test('dashboard audio streams default to one per user', () => {
    assert.equal(maxAudioStreamsPerUser(undefined), 1);
    assert.equal(maxAudioStreamsPerUser(''), 1);
    assert.equal(maxAudioStreamsPerUser('0'), 1);
    assert.equal(maxAudioStreamsPerUser('-1'), 1);
    assert.equal(maxAudioStreamsPerUser('not-a-number'), 1);
});

test('dashboard audio stream limit can be raised for an isolated test', () => {
    assert.equal(maxAudioStreamsPerUser('10'), 10);
    assert.equal(maxAudioStreamsPerUser('2.9'), 2);
});
