import assert from 'node:assert/strict';
import test from 'node:test';

import { isFinishedTrackReason } from '../dist/utils/TrackEndReason.js';

test('natural track end detection is case-insensitive', () => {
    assert.equal(isFinishedTrackReason('finished'), true);
    assert.equal(isFinishedTrackReason('FINISHED'), true);
    assert.equal(isFinishedTrackReason('stopped'), false);
    assert.equal(isFinishedTrackReason('replaced'), false);
    assert.equal(isFinishedTrackReason(null), false);
});
