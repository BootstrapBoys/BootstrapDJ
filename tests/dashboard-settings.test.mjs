import assert from 'node:assert/strict';
import test from 'node:test';

import {
    saveSetting,
    saveSettings,
    SettingValidationError,
    validateSetting,
} from '../dist/dashboard/state.js';

function makeClient({ current = null } = {}) {
    const calls = { applied: [], autoplayReads: 0 };
    return {
        calls,
        client: {
            config: { autoplaySeeds: ['alpha', 'beta'], autoplayChart: false },
            db: {
                getAutoplaySetting: async () => {
                    calls.autoplayReads += 1;
                    return current;
                },
                applySettings: async (guildId, entries, autoplay) => {
                    calls.applied.push({ guildId, entries, autoplay });
                },
            },
        },
    };
}

test('a form with source and seeds writes one autoplay row and keeps the source', async () => {
    const { client, calls } = makeClient();

    await saveSettings(client, 'g1', {
        autoplaysource: 'chart',
        autoplayseeds: 'NF, Hotel Books',
        defaultvolume: '80',
    });

    assert.equal(calls.applied.length, 1);
    assert.deepEqual(calls.applied[0].entries, { defaultvolume: '80' });
    assert.deepEqual(calls.applied[0].autoplay, {
        source: 'chart',
        seeds: 'NF, Hotel Books',
    });
});

test('editing seeds preserves the stored source instead of forcing curated', async () => {
    const { client, calls } = makeClient({ current: { source: 'chart', seeds: 'old' } });

    await saveSettings(client, 'g1', { autoplayseeds: 'new one, new two' });

    assert.deepEqual(calls.applied[0].autoplay, {
        source: 'chart',
        seeds: 'new one, new two',
    });
});

test('editing only the source keeps the stored seeds', async () => {
    const { client, calls } = makeClient({ current: { source: 'curated', seeds: 'kept' } });

    await saveSetting(client, 'g1', 'autoplaysource', 'legacy');

    assert.deepEqual(calls.applied[0].autoplay, { source: 'legacy', seeds: 'kept' });
});

test('a reset-only request deletes the autoplay override', async () => {
    const { client, calls } = makeClient();

    await saveSetting(client, 'g1', 'autoplayreset', 'true');

    assert.deepEqual(calls.applied[0].entries, {});
    assert.equal(calls.applied[0].autoplay, 'delete');
});

test('the whole batch is validated before anything is written', async () => {
    const { client, calls } = makeClient();

    await assert.rejects(
        () => saveSettings(client, 'g1', { defaultvolume: '80', notasetting: '1' }),
        error => error instanceof SettingValidationError && /Unknown setting/.test(error.message)
    );
    assert.equal(calls.applied.length, 0, 'a rejected form must not write its valid keys');

    await assert.rejects(
        () => saveSettings(client, 'g1', { defaultvolume: '80', ephemeral: 'sometimes' }),
        SettingValidationError
    );
    assert.equal(calls.applied.length, 0);
});

test('validation normalizes enums, booleans, integers and seeds', () => {
    assert.equal(validateSetting('defaultrepeat', 'REPEAT'), 'repeat');
    assert.equal(validateSetting('ephemeral', 'TRUE'), 'true');
    assert.equal(validateSetting('defaultvolume', ' 80 '), '80');
    assert.equal(validateSetting('defaultvolume', ''), '');
    assert.equal(
        validateSetting('autoplayseeds', ' a, b, ,c, d, e, f, g, h, i, j, k '),
        'a, b, c, d, e, f, g, h, i, j'
    );
});

test('out-of-range numbers and malformed enums are rejected', () => {
    for (const [key, value] of [
        ['defaultvolume', '201'],
        ['defaultvolume', '-1'],
        ['voteskippercent', '101'],
        ['loudnesstarget', '1'],
        ['timeoutlisteners', '1.5'],
        ['maxtracklength', 'soon'],
        ['defaultrepeat', 'forever'],
        ['autoplaysource', 'radio'],
    ]) {
        assert.throws(() => validateSetting(key, value), SettingValidationError, `${key}=${value}`);
    }
});
