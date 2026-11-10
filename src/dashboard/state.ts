import type { BootstrapClient } from '../core/index.js';
import { AUTOPLAY_FIELDS, DEFAULTS, isKnownSetting } from '../lib/SettingsSchema.js';
import { FILTERS } from './filters.js';
import type { PlayerSnapshot } from './shardApi.js';

const AUTOPLAY_SOURCES = ['chart', 'curated', 'legacy'];
const REPEAT_MODES = ['off', 'repeat', 'queue'];

const BOOLEAN_SETTINGS = new Set([
    'defaultautoplay',
    'defaultshuffle',
    'voteskip',
    'announce',
    'ephemeral',
    'autocorrect',
    'volumeautomatic',
    'locked',
    'allowthreads',
    'dashboardvoicepriority',
]);

/** Integer settings and their accepted range (undefined = any >= 0). */
const NUMERIC_SETTINGS = new Map<string, { min: number; max: number }>([
    ['defaultvolume', { min: 0, max: 200 }],
    ['maxqueue', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['maxuserqueue', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['voteskippercent', { min: 0, max: 100 }],
    ['deleteafter', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['maxtracklength', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['mintracklength', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['maxusertracks', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['maxusertrackslength', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['maxplaylisttracks', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['maxplaylistlength', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['loudnesstarget', { min: -60, max: 0 }],
    ['timeoutlisteners', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['timeoutpause', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['timeoutplaying', { min: 0, max: Number.MAX_SAFE_INTEGER }],
    ['timeoutconfirmation', { min: 0, max: Number.MAX_SAFE_INTEGER }],
]);

const MAX_VALUE_LENGTH = 1_000;
const MAX_AUTOPLAY_SEEDS = 10;

/** A dashboard input that must be reported as 400, not as a server failure. */
export class SettingValidationError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'SettingValidationError';
    }
}

function normalizeSeeds(value: string): string {
    return value
        .split(',')
        .map(seed => seed.trim())
        .filter(Boolean)
        .slice(0, MAX_AUTOPLAY_SEEDS)
        .join(', ');
}

/**
 * Validate and normalize one dashboard value. An empty string stays an
 * explicit "unset" for every key except autoplay source, which is ignored by
 * the caller; non-empty enums, booleans and integers must be exact.
 */
export function validateSetting(key: string, value: string): string {
    if (value.length > MAX_VALUE_LENGTH) {
        throw new SettingValidationError(`${key} is longer than ${MAX_VALUE_LENGTH} characters.`);
    }
    if (key === 'autoplayseeds') return normalizeSeeds(value);
    if (value === '') return '';

    if (key === 'autoplaysource') {
        const source = value.trim().toLowerCase();
        if (!AUTOPLAY_SOURCES.includes(source)) {
            throw new SettingValidationError('Autoplay source must be chart, curated, or legacy.');
        }
        return source;
    }
    if (key === 'defaultrepeat') {
        const mode = value.trim().toLowerCase();
        if (!REPEAT_MODES.includes(mode)) {
            throw new SettingValidationError('Repeat mode must be off, repeat, or queue.');
        }
        return mode;
    }
    if (BOOLEAN_SETTINGS.has(key)) {
        const flag = value.trim().toLowerCase();
        if (flag !== 'true' && flag !== 'false') {
            throw new SettingValidationError(`${key} must be true or false.`);
        }
        return flag;
    }
    const numeric = NUMERIC_SETTINGS.get(key);
    if (numeric) {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < numeric.min || parsed > numeric.max) {
            throw new SettingValidationError(
                `${key} must be an integer between ${numeric.min} and ${numeric.max}.`
            );
        }
        return String(parsed);
    }
    return value;
}

/** Fields of a player snapshot that are safe to ship with the page state. */
function playerView(player: PlayerSnapshot | null): Record<string, unknown> | null {
    if (!player) return null;
    return {
        title: player.title,
        author: player.author,
        duration: player.duration,
        position: player.position,
        queueLength: player.queueLength,
        upcoming: player.upcoming,
        volume: player.volume,
        paused: player.paused,
        loop: player.loop,
        autoplay: player.autoplay,
    };
}

function filterView(player: PlayerSnapshot | null): Array<Record<string, unknown>> {
    const active = new Set((player?.activeFilters ?? []).map(name => name.toLowerCase()));
    return FILTERS.map(filter => ({
        id: filter.id,
        label: filter.label,
        description: filter.description,
        value: filter.value,
        current: player?.filterValues[filter.id],
        active: active.has((filter.activeName ?? filter.id).toLowerCase()),
    }));
}

/**
 * Initial page state. Settings are replaced by the caller when the viewer may
 * manage the guild; read-only viewers get defaults so stored values never leak.
 */
export function initialState(
    guildId: string,
    player: PlayerSnapshot | null
): Record<string, unknown> {
    return {
        guildId,
        player: playerView(player),
        filters: filterView(player),
        settings: { ...DEFAULTS },
    };
}

/** Effective settings: schema defaults, stored overrides, then autoplay rows. */
export async function effectiveSettings(
    client: BootstrapClient,
    guildId: string
): Promise<Record<string, string>> {
    const stored = await client.db.getGuildSettings(guildId);
    const autoplay = await client.db.getAutoplaySetting(guildId).catch(() => null);
    const merged: Record<string, string> = { ...DEFAULTS, ...stored };

    if (autoplay) {
        merged.autoplaysource = autoplay.source;
        merged.autoplayseeds = autoplay.seeds;
    }

    // ownerid is managed by the permission claim flow, not the settings form.
    return Object.fromEntries(
        Object.entries(merged).filter(
            ([key]) =>
                Object.prototype.hasOwnProperty.call(DEFAULTS, key) || AUTOPLAY_FIELDS.has(key)
        )
    );
}

function defaultAutoplaySource(client: BootstrapClient, seeds: string): string {
    if (seeds) return 'curated';
    return client.config.autoplayChart ? 'chart' : 'legacy';
}

/**
 * Validate a whole dashboard form before writing anything, then persist it in
 * one transaction. Autoplay source and seeds are merged into a single
 * `AutoplaySetting` row, so a form that sends both cannot force `curated` over
 * the source the operator picked.
 */
export async function saveSettings(
    client: BootstrapClient,
    guildId: string,
    values: Record<string, string>
): Promise<void> {
    const entries: Record<string, string> = {};
    let source: string | undefined;
    let seeds: string | undefined;
    let reset = false;

    for (const [key, raw] of Object.entries(values)) {
        if (key === 'autoplayreset') {
            reset = raw !== '' && raw !== 'false' && raw !== '0';
            continue;
        }
        if (!isKnownSetting(key)) throw new SettingValidationError(`Unknown setting: ${key}`);
        const value = validateSetting(key, raw);
        if (key === 'autoplaysource') {
            if (value) source = value;
        } else if (key === 'autoplayseeds') {
            seeds = value;
        } else {
            entries[key] = value;
        }
    }

    let autoplay: { source: string; seeds: string } | 'delete' | null = null;
    if (source !== undefined || seeds !== undefined) {
        const current = await client.db.getAutoplaySetting(guildId).catch(() => null);
        const chosenSeeds = seeds ?? current?.seeds ?? client.config.autoplaySeeds.join(', ');
        autoplay = {
            source: source ?? current?.source ?? defaultAutoplaySource(client, chosenSeeds),
            seeds: chosenSeeds,
        };
    } else if (reset) {
        autoplay = 'delete';
    }

    await client.db.applySettings(guildId, entries, autoplay);
}

/** Single-key compatibility wrapper for the reset button and API clients. */
export async function saveSetting(
    client: BootstrapClient,
    guildId: string,
    key: string,
    value: string
): Promise<void> {
    await saveSettings(client, guildId, { [key]: value });
}
