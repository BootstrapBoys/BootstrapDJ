import type { BootstrapClient } from '../core/index.js';
import { AUTOPLAY_FIELDS, DEFAULTS, isKnownSetting } from '../lib/SettingsSchema.js';
import { FILTERS } from './filters.js';
import type { PlayerSnapshot } from './shardApi.js';

const AUTOPLAY_SOURCES = ['chart', 'curated', 'legacy'];

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

async function saveAutoplaySetting(
    client: BootstrapClient,
    guildId: string,
    key: string,
    value: string
): Promise<void> {
    if (key === 'autoplayreset') {
        await client.db.deleteAutoplaySetting(guildId);
        return;
    }
    if (!value && key !== 'autoplayseeds') return;

    const current = await client.db.getAutoplaySetting(guildId).catch(() => null);
    if (key === 'autoplaysource') {
        if (!AUTOPLAY_SOURCES.includes(value)) throw new Error('Invalid autoplay source');
        await client.db.setAutoplaySetting(guildId, {
            source: value,
            seeds: current?.seeds ?? client.config.autoplaySeeds.join(', '),
        });
        return;
    }
    await client.db.setAutoplaySetting(guildId, { source: 'curated', seeds: value });
}

/** Validate and persist one dashboard setting. Unknown keys are rejected. */
export async function saveSetting(
    client: BootstrapClient,
    guildId: string,
    key: string,
    value: string
): Promise<void> {
    if (!isKnownSetting(key)) throw new Error(`Unknown setting: ${key}`);
    if (AUTOPLAY_FIELDS.has(key)) {
        await saveAutoplaySetting(client, guildId, key, value);
        return;
    }
    await client.db.setGuildSetting(guildId, key, value);
}
