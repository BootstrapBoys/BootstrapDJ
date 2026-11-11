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
} from '../dist/lib/i18n.js';

test('locale catalogs expose the initial supported languages', () => {
    assert.deepEqual(SUPPORTED_LANGUAGES, ['en-GB', 'en-US']);
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

test('localized command descriptions contain every shipped locale', () => {
    const descriptions = localizedDescriptions('commands:language.description');
    assert.equal(descriptions['en-US'], 'View or change the language for this server');
    assert.equal(descriptions['en-GB'], 'View or change the language for this server');
});

test('every locale has the same keys in the shipped namespaces', () => {
    const root = path.resolve(process.cwd(), 'locales');
    const namespaces = ['common', 'commands', 'events', 'buttons', 'errors', 'dashboard'];
    const flatten = (value, prefix = '') => {
        if (value === null || typeof value !== 'object') return [prefix];
        return Object.entries(value).flatMap(([key, child]) =>
            flatten(child, prefix ? `${prefix}.${key}` : key)
        );
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
