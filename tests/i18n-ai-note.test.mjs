import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const AI_LOCALES = [
    'de',
    'es-ES',
    'fr',
    'id',
    'it',
    'ja',
    'ko',
    'nl',
    'pl',
    'pt-BR',
    'ru',
    'tr',
    'zh-CN',
    'zh-TW',
];
const NAMESPACES = ['common', 'commands', 'events', 'buttons', 'errors', 'dashboard'];

test('every AI-translated locale file carries the native-review note', () => {
    for (const locale of AI_LOCALES) {
        for (const namespace of NAMESPACES) {
            const file = path.join('locales', locale, `${namespace}.json`);
            const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
            assert.equal(
                catalog._meta?.note,
                '**AI Translated, awaiting native translation**',
                `${file} is missing the native-review note`
            );
        }
    }
});
