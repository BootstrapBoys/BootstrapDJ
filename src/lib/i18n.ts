import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import i18next, { type Resource } from 'i18next';

/** Canonical locale used when a guild has no valid override. */
export const DEFAULT_LANGUAGE = 'en-US';

const NAMESPACES = [
    'common',
    'commands',
    'events',
    'buttons',
    'errors',
    'dashboard',
    'longtail',
] as const;
/** Resolve from the module, not the shell cwd; pm2 and tests start differently. */
const LOCALES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../locales');

type LocaleResources = Resource;

function readResources(): { resources: LocaleResources; languages: string[] } {
    const languages = fs
        .readdirSync(LOCALES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
    const resources: LocaleResources = {};

    for (const language of languages) {
        const locale: Record<string, Record<string, unknown>> = {};
        for (const namespace of NAMESPACES) {
            const file = path.join(LOCALES_DIR, language, `${namespace}.json`);
            if (!fs.existsSync(file)) continue;
            locale[namespace] = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
                string,
                unknown
            >;
        }
        if (Object.keys(locale).length > 0) resources[language] = locale;
    }

    if (!resources[DEFAULT_LANGUAGE]) {
        throw new Error(`Missing locale catalog: ${path.join(LOCALES_DIR, DEFAULT_LANGUAGE)}`);
    }
    return { resources, languages: Object.keys(resources).sort() };
}

const loaded = readResources();

/** Stable, sorted locale codes discovered from the shipped catalogs. */
export const SUPPORTED_LANGUAGES: readonly string[] = loaded.languages;

/** Normalize scalar input without stringifying arbitrary objects. */
function rawLanguage(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return '';
}

/**
 * Normalize user input against the shipped catalogs. Locale codes are
 * case-insensitive (`en-gb` -> `en-GB`); anything unknown falls back to the
 * canonical default instead of leaking an arbitrary string into i18next.
 */
export function resolveLanguage(value: unknown): string {
    const raw = rawLanguage(value);
    if (!raw) return DEFAULT_LANGUAGE;
    const match = SUPPORTED_LANGUAGES.find(
        language => language.toLowerCase() === raw.toLowerCase()
    );
    return match ?? DEFAULT_LANGUAGE;
}

export function isSupportedLanguage(value: unknown): boolean {
    const raw = rawLanguage(value);
    return SUPPORTED_LANGUAGES.some(language => language.toLowerCase() === raw.toLowerCase());
}

void i18next.init({
    resources: loaded.resources,
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
});

/** Translate one key, preserving i18next's fallback behavior. */
export function translate(
    key: string,
    language: string = DEFAULT_LANGUAGE,
    variables: Record<string, string | number> = {}
): string {
    const value = i18next.t(key, { lng: resolveLanguage(language), ...variables });
    return typeof value === 'string' ? value : String(value);
}

/** Localized option descriptions for slash-command registration. */
export function localizedDescriptions(key: string): Record<string, string> {
    const localizations: Record<string, string> = {};
    for (const language of SUPPORTED_LANGUAGES) {
        const value = translate(key, language);
        if (value && value !== key) localizations[language] = value;
    }
    return localizations;
}

/**
 * Whether the catalog actually has this key. A missing key comes back from
 * i18next as a namespace-stripped path, so comparing the translated value with
 * the requested key is not a reliable presence check.
 */
export function hasTranslation(key: string, language: string = DEFAULT_LANGUAGE): boolean {
    return i18next.exists(key, { lng: resolveLanguage(language) });
}

/** Native names for language pickers; do not translate another language's name. */
const LANGUAGE_NAMES: Record<string, string> = {
    de: 'Deutsch',
    'en-GB': 'English (United Kingdom)',
    'en-US': 'English (United States)',
    'es-ES': 'Español (España)',
    fr: 'Français',
    id: 'Bahasa Indonesia',
    it: 'Italiano',
    ja: '日本語',
    ko: '한국어',
    nl: 'Nederlands',
    pl: 'Polski',
    'pt-BR': 'Português (Brasil)',
    ru: 'Русский',
    tr: 'Türkçe',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
};

export function languageName(language: string): string {
    return LANGUAGE_NAMES[language] ?? language;
}
