#!/usr/bin/env node
/**
 * Merge English long-tail fragments into locales/en-US/longtail.json and seed
 * missing keys into every other locale. Existing translations are never
 * overwritten; duplicate fragment keys with different values are rejected.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fragmentDir = resolve(
    process.argv[2] ?? join(homedir(), '.hermes', 'cache', 'scratch', 'i18n-fragments')
);
const localesDir = join(root, 'locales');
const sourcePath = join(localesDir, 'en-US', 'longtail.json');
const AI_NOTE = '**AI Translated, awaiting native translation**';

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(target, source, path = []) {
    for (const [key, value] of Object.entries(source)) {
        if (key.startsWith('_')) continue;
        const next = [...path, key];
        if (isObject(value)) {
            if (target[key] !== undefined && !isObject(target[key])) {
                throw new Error(`fragment conflict at ${next.join('.')}: existing scalar`);
            }
            target[key] ??= {};
            merge(target[key], value, next);
            continue;
        }
        if (target[key] !== undefined && target[key] !== value) {
            throw new Error(
                `fragment conflict at ${next.join('.')}: ${JSON.stringify(target[key])} vs ${JSON.stringify(value)}`
            );
        }
        target[key] = value;
    }
}

function fillMissing(target, source) {
    let added = 0;
    for (const [key, value] of Object.entries(source)) {
        if (key.startsWith('_')) continue;
        if (isObject(value)) {
            if (target[key] === undefined) target[key] = {};
            if (isObject(target[key])) added += fillMissing(target[key], value);
            continue;
        }
        if (target[key] === undefined) {
            target[key] = value;
            added += 1;
        }
    }
    return added;
}

const fragmentFiles = readdirSync(fragmentDir)
    .filter(name => name.endsWith('.json'))
    .sort();
if (fragmentFiles.length === 0) {
    throw new Error(`no fragment JSON files in ${fragmentDir}`);
}

const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
let merged = 0;
for (const name of fragmentFiles) {
    const fragment = JSON.parse(readFileSync(join(fragmentDir, name), 'utf8'));
    if (!isObject(fragment)) throw new Error(`${name}: fragment must be an object`);
    merge(source, fragment);
    merged += 1;
}
writeFileSync(sourcePath, `${JSON.stringify(source, null, 4)}\n`);

const locales = readdirSync(localesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => name !== 'en-US');

let seeded = 0;
for (const locale of locales) {
    const path = join(localesDir, locale, 'longtail.json');
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    seeded += fillMissing(catalog, source);
    if (!isObject(catalog._meta)) catalog._meta = {};
    catalog._meta.note = AI_NOTE;
    writeFileSync(path, `${JSON.stringify(catalog, null, 4)}\n`);
}

console.log(
    `merged ${merged} fragment(s) into en-US; seeded ${seeded} missing value(s) across ${locales.length} locales`
);
