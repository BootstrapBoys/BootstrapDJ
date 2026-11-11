import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    isSupportedLanguage,
    localizedDescriptions,
    resolveLanguage,
    translate,
    languageName,
} from '../dist/lib/i18n.js';

test('locale catalogs expose the initial supported languages', () => {
    assert.deepEqual(SUPPORTED_LANGUAGES, [
        'de',
        'en-GB',
        'en-US',
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
    ]);
    assert.equal(DEFAULT_LANGUAGE, 'en-US');
});

test('locale codes normalize case-insensitively and invalid input falls back', () => {
    assert.equal(resolveLanguage('en-gb'), 'en-GB');
    assert.equal(resolveLanguage('EN-us'), 'en-US');
    assert.equal(resolveLanguage('fr-FR'), 'en-US');
    assert.equal(isSupportedLanguage('en-GB'), true);
    assert.equal(isSupportedLanguage('fr-FR'), false);
});

test('translations are selected by locale and interpolate variables', () => {
    assert.equal(translate('common:language.name', 'en-US'), 'English (United States)');
    assert.equal(translate('common:language.name', 'en-GB'), 'English (United Kingdom)');
    assert.equal(
        translate('common:language.current', 'en-US', { language: 'English (United States)' }),
        'Current language: **English (United States)**.'
    );
});

test('language pickers use native names rather than translating the fallback name', () => {
    assert.equal(languageName('es-ES'), 'Español (España)');
    assert.equal(languageName('ja'), '日本語');
    assert.equal(languageName('zh-TW'), '繁體中文');
});

test('localized command descriptions contain every shipped locale', () => {
    const descriptions = localizedDescriptions('commands:language.description');
    assert.equal(descriptions['en-US'], 'View or change the language for this server');
    assert.equal(descriptions['en-GB'], 'View or change the language for this server');
});

test('every locale has the same keys in the shipped namespaces', () => {
    const root = path.resolve(process.cwd(), 'locales');
    const namespaces = [
        'common',
        'commands',
        'events',
        'buttons',
        'errors',
        'dashboard',
        'longtail',
    ];
    const flatten = (value, prefix = '') => {
        if (value === null || typeof value !== 'object') return [prefix];
        return Object.entries(value)
            .filter(([key]) => !key.startsWith('_'))
            .flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
    };
    const keysFor = language => {
        const keys = [];
        for (const namespace of namespaces) {
            const file = path.join(root, language, `${namespace}.json`);
            keys.push(...flatten(JSON.parse(fs.readFileSync(file, 'utf8')), namespace));
        }
        return keys.sort();
    };
    const fallback = keysFor('en-US');
    for (const language of SUPPORTED_LANGUAGES) {
        assert.deepEqual(keysFor(language), fallback, `${language} has a different key set`);
    }
});
