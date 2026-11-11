import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateLocales } from '../tooling/i18n-validate.mjs';

test('shipped locale catalogs pass missing-key and placeholder validation', () => {
    const result = validateLocales();
    assert.deepEqual(result.errors, []);
});
