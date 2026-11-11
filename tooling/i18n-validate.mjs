import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../locales');
const REQUIRED_NAMESPACES = ['common', 'commands', 'events', 'buttons', 'errors', 'dashboard'];
const FALLBACK = 'en-US';
const DESCRIPTION_LIMIT = 100;

function flatten(value, prefix = '') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [prefix];
    }
    return Object.entries(value).flatMap(([key, child]) =>
        flatten(child, prefix ? `${prefix}.${key}` : key)
    );
}

function readCatalog(language) {
    const dir = path.join(ROOT, language);
    const catalog = {};
    for (const namespace of REQUIRED_NAMESPACES) {
        const file = path.join(dir, `${namespace}.json`);
        if (!fs.existsSync(file)) {
            throw new Error(`${language}: missing ${namespace}.json`);
        }
        try {
            catalog[namespace] = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            throw new Error(`${language}/${namespace}.json: invalid JSON (${error.message})`);
        }
    }
    return catalog;
}

function placeholders(value) {
    return [...String(value).matchAll(/{{[^}]+}}/g)].map(match => match[0]).sort();
}

function get(catalog, key) {
    return key.split('.').reduce((current, part) => current?.[part], catalog);
}

/** Validate every shipped locale against the fallback catalog. */
export function validateLocales() {
    const languages = fs
        .readdirSync(ROOT, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
    if (!languages.includes(FALLBACK)) {
        return { errors: [`missing fallback locale ${FALLBACK}`], warnings: [] };
    }

    const errors = [];
    const warnings = [];
    const catalogs = {};
    for (const language of languages) {
        try {
            catalogs[language] = readCatalog(language);
        } catch (error) {
            errors.push(error.message);
        }
    }
    if (errors.length) return { errors, warnings };

    const fallbackKeys = Object.keys(catalogs[FALLBACK]).flatMap(namespace =>
        flatten(catalogs[FALLBACK][namespace], namespace)
    );
    const fallbackSet = new Set(fallbackKeys);

    for (const language of languages) {
        if (language === FALLBACK) continue;
        const keys = Object.keys(catalogs[language]).flatMap(namespace =>
            flatten(catalogs[language][namespace], namespace)
        );
        const keySet = new Set(keys);
        for (const key of fallbackKeys) {
            if (!keySet.has(key)) errors.push(`${language}: missing key ${key}`);
        }
        for (const key of keys) {
            if (!fallbackSet.has(key)) warnings.push(`${language}: extra key ${key}`);
        }
        for (const key of fallbackKeys) {
            if (!keySet.has(key)) continue;
            const expected = placeholders(get(catalogs[FALLBACK], key));
            const actual = placeholders(get(catalogs[language], key));
            if (expected.join('|') !== actual.join('|')) {
                errors.push(
                    `${language}: placeholder mismatch at ${key} (expected ${expected.join(', ') || 'none'}, got ${actual.join(', ') || 'none'})`
                );
            }
        }
    }

    for (const language of languages) {
        const metadata = catalogs[language].commands?.metadata ?? {};
        for (const [name, entry] of Object.entries(metadata)) {
            if (typeof entry.description !== 'string' || !entry.description.length) {
                errors.push(`${language}: ${name} has no command description`);
            } else if (entry.description.length > DESCRIPTION_LIMIT) {
                errors.push(
                    `${language}: ${name} description is ${entry.description.length} chars (max ${DESCRIPTION_LIMIT})`
                );
            }
            for (const [option, description] of Object.entries(entry.options ?? {})) {
                if (description.length > DESCRIPTION_LIMIT) {
                    errors.push(
                        `${language}: ${name}.${option} description is ${description.length} chars (max ${DESCRIPTION_LIMIT})`
                    );
                }
            }
        }
    }

    return { errors, warnings };
}

function main() {
    const { errors, warnings } = validateLocales();
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    if (errors.length) {
        for (const error of errors) console.error(`error: ${error}`);
        process.exitCode = 1;
        return;
    }
    console.log(
        `i18n catalogs valid: ${fs
            .readdirSync(ROOT)
            .filter(name => fs.statSync(path.join(ROOT, name)).isDirectory())
            .join(', ')}`
    );
    if (warnings.length) console.warn(`${warnings.length} warning(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
