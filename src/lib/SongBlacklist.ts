import type { BootstrapClient, Context } from '../core/index.js';
import type Dispatcher from '../core/Dispatcher.js';

import { translate } from './i18n.js';
import { requesterId } from './QueueTools.js';

/**
 * GuildSetting key holding the song-request blacklist.
 *
 * It is deliberately not part of `SettingsSchema`: the value is a JSON document
 * managed only by `/utility songblacklist`, not a scalar an admin edits through
 * `/settings` or the dashboard.
 */
export const SONGBLACKLIST_KEY = 'songblacklist';

/** Keeps one settings row small; it is re-read on every play request. */
export const SONGBLACKLIST_MAX = 100;

const MAX_REASON_LENGTH = 200;
const USER_ID = /^\d{17,20}$/;

export type SongBlacklistEntry = {
    id: string;
    reason: string;
    /** Who added the entry, for audit. */
    by: string;
    /** ISO timestamp of the write. */
    at: string;
};

export type SongBlacklistWrite = 'added' | 'updated' | 'full';

function normalizeEntry(value: unknown): SongBlacklistEntry | null {
    // A bare id is accepted so a hand-edited CSV value still enforces.
    if (typeof value === 'string') {
        const id = value.trim();
        return USER_ID.test(id) ? { id, reason: '', by: '', at: '' } : null;
    }
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!USER_ID.test(id)) return null;
    return {
        id,
        reason: typeof record.reason === 'string' ? record.reason.slice(0, MAX_REASON_LENGTH) : '',
        by: typeof record.by === 'string' && USER_ID.test(record.by) ? record.by : '',
        at: typeof record.at === 'string' ? record.at : '',
    };
}

/** Parse the stored value; malformed rows are dropped rather than thrown. */
export function parseSongBlacklist(raw: string | null | undefined): SongBlacklistEntry[] {
    if (!raw || !raw.trim()) return [];
    let values: unknown[];
    try {
        const parsed: unknown = JSON.parse(raw);
        values = Array.isArray(parsed) ? parsed : [];
    } catch {
        // Legacy tolerance: a comma-separated list of ids.
        values = raw.split(/[\s,]+/).filter(Boolean);
    }
    const seen = new Set<string>();
    const entries: SongBlacklistEntry[] = [];
    for (const value of values) {
        const entry = normalizeEntry(value);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(entry);
    }
    return entries;
}

export function serializeSongBlacklist(entries: readonly SongBlacklistEntry[]): string {
    return JSON.stringify(entries);
}

/** Read the blacklist for a guild through the cached settings lookup. */
export async function getSongBlacklist(
    client: BootstrapClient,
    guildId: string
): Promise<SongBlacklistEntry[]> {
    const settings: Record<string, string> = await client.db
        .getGuildSettings(guildId)
        .catch(() => ({}));
    return parseSongBlacklist(settings?.[SONGBLACKLIST_KEY]);
}

/** The entry when a user may not submit songs, otherwise null. */
export async function getSongBlacklistEntry(
    client: BootstrapClient,
    guildId: string,
    userId: string
): Promise<SongBlacklistEntry | null> {
    const entries = await getSongBlacklist(client, guildId);
    return entries.find(entry => entry.id === userId) ?? null;
}

export async function addSongBlacklistEntry(
    client: BootstrapClient,
    guildId: string,
    userId: string,
    by: string,
    reason = ''
): Promise<SongBlacklistWrite> {
    const entries = await getSongBlacklist(client, guildId);
    const existing = entries.find(entry => entry.id === userId);
    const entry: SongBlacklistEntry = {
        id: userId,
        reason: reason.trim().slice(0, MAX_REASON_LENGTH),
        by,
        at: new Date().toISOString(),
    };
    if (existing) {
        const next = entries.map(item => (item.id === userId ? entry : item));
        await client.db.setGuildSetting(guildId, SONGBLACKLIST_KEY, serializeSongBlacklist(next));
        return 'updated';
    }
    if (entries.length >= SONGBLACKLIST_MAX) return 'full';
    await client.db.setGuildSetting(
        guildId,
        SONGBLACKLIST_KEY,
        serializeSongBlacklist([...entries, entry])
    );
    return 'added';
}

export async function removeSongBlacklistEntry(
    client: BootstrapClient,
    guildId: string,
    userId: string
): Promise<boolean> {
    const entries = await getSongBlacklist(client, guildId);
    const next = entries.filter(entry => entry.id !== userId);
    if (next.length === entries.length) return false;
    await client.db.setGuildSetting(guildId, SONGBLACKLIST_KEY, serializeSongBlacklist(next));
    return true;
}

/** Drop every queued track the user requested; the current track is untouched. */
export async function purgeUserRequests(player: Dispatcher, userId: string): Promise<number> {
    const remaining = player.queue.filter(track => requesterId(track) !== userId);
    const removed = player.queue.length - remaining.length;
    if (removed === 0) return 0;
    player.queue = remaining;
    await player.persist();
    return removed;
}

/** Localized refusal text, including the stored reason when one exists. */
export function blacklistText(language: string, entry: SongBlacklistEntry): string {
    return entry.reason
        ? translate('longtail:limits.blacklistedWithReason', language, { reason: entry.reason })
        : translate('longtail:limits.blacklisted', language);
}

/**
 * Command-side guard. Returns true when the caller is blacklisted and the
 * refusal has already been sent, so the command can return immediately.
 */
export async function rejectBlacklistedRequester(
    client: BootstrapClient,
    ctx: Context
): Promise<boolean> {
    const guild = ctx.guild;
    const author = ctx.author;
    if (!guild || !author) return false;
    const entry = await getSongBlacklistEntry(client, guild.id, author.id);
    if (!entry) return false;
    await ctx.sendMessage({
        embeds: [
            client
                .embed()
                .setColor(client.color.red)
                .setDescription(blacklistText(ctx.locale, entry)),
        ],
    });
    return true;
}
