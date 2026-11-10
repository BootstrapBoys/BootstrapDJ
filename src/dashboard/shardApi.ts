import { PermissionFlagsBits } from 'discord.js';
import type { Guild, GuildMember } from 'discord.js';

import type Dispatcher from '../core/Dispatcher.js';
import type { BootstrapClient } from '../core/index.js';
import { applyFilter } from './filters.js';

/** What the signed-in viewer may do in one guild. */
export type GuildAccess = {
    member: boolean;
    owner: boolean;
    admin: boolean;
    controls: boolean;
    settings: boolean;
    listen: boolean;
};

export const NO_ACCESS: GuildAccess = {
    member: false,
    owner: false,
    admin: false,
    controls: false,
    settings: false,
    listen: false,
};

export const FULL_ACCESS: GuildAccess = {
    member: true,
    owner: true,
    admin: true,
    controls: true,
    settings: true,
    listen: true,
};

export interface AccessResult {
    found: boolean;
    access: GuildAccess;
}

export interface DashboardGuild extends GuildAccess {
    id: string;
    name: string;
}

export interface PlayerSnapshot {
    title: string | null;
    author: string | null;
    duration: number;
    position: number;
    queueLength: number;
    upcoming: Array<{ position: number; title: string; author: string; duration: number }>;
    volume: number;
    paused: boolean;
    loop: 'off' | 'repeat' | 'queue';
    autoplay: boolean;
    activeFilters: string[];
    filterValues: Record<string, number>;
}

export interface FilterResult {
    found: boolean;
    active: string[];
    /** User-safe reason the filter write failed. */
    error?: string;
    /** HTTP status the dashboard route should return on failure. */
    status?: number;
}

export interface ActionError {
    ok: boolean;
    found: boolean;
    error?: string;
    /** HTTP status the dashboard route should return on failure. */
    status?: number;
}

/** Dashboard preview of the queue: enough rows to fill the panel, no more. */
const UPCOMING_LIMIT = 20;
const LOOP_MODES: ReadonlyArray<'off' | 'repeat' | 'queue'> = ['off', 'repeat', 'queue'];

async function memberOf(guild: Guild, userId: string): Promise<GuildMember | null> {
    const cached = guild.members.cache.get(userId);
    if (cached) return cached;
    return await guild.members.fetch(userId).catch(() => null);
}

function mayManageGuild(member: GuildMember): boolean {
    return (
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.permissions.has(PermissionFlagsBits.Administrator)
    );
}

/**
 * Token mode has no user identity, so the dashboard operator gets full access.
 * OAuth mode is member-scoped: DJ roles unlock transport controls, guild
 * managers unlock settings, and only the owner may clear statistics.
 */
export async function guildAccessFor(
    client: BootstrapClient,
    userId: string | null,
    guildId: string
): Promise<AccessResult> {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { found: false, access: NO_ACCESS };
    if (!userId) return { found: true, access: FULL_ACCESS };

    const member = await memberOf(guild, userId);
    if (!member) return { found: true, access: NO_ACCESS };

    const owner = guild.ownerId === userId;
    const admin = owner || mayManageGuild(member);
    const djRoles = await client.db.getRoles(guildId).catch(() => []);
    const controls = admin || djRoles.some(role => member.roles.cache.has(role.roleId));
    const settings: Record<string, string> = await client.db
        .getGuildSettings(guildId)
        .catch(() => ({}));
    const audioTapAllowAll = settings.audiotapallowall !== 'false';
    const audioTapRoles = String(settings.audiotaproles ?? '')
        .split(/[\s,]+/)
        .filter(roleId => /^\d{17,20}$/.test(roleId));
    const listen =
        owner ||
        admin ||
        audioTapAllowAll ||
        audioTapRoles.some(roleId => member.roles.cache.has(roleId));

    return {
        found: true,
        access: { member: true, owner, admin, controls, settings: admin, listen },
    };
}

export async function dashboardGuilds(
    client: BootstrapClient,
    userId: string | null
): Promise<DashboardGuild[]> {
    const visible = await Promise.all(
        [...client.guilds.cache.values()].map(async guild => {
            const access = userId
                ? (await guildAccessFor(client, userId, guild.id)).access
                : FULL_ACCESS;
            if (!access.member) return null;
            return { id: guild.id, name: guild.name, ...access };
        })
    );
    return visible.filter((row): row is DashboardGuild => row !== null);
}

export function dashboardGuildIds(client: BootstrapClient): string[] {
    return [...client.guilds.cache.keys()];
}

export function playerSnapshot(player: Dispatcher | undefined): PlayerSnapshot | null {
    if (!player) return null;
    return {
        title: player.current?.info.title ?? null,
        author: player.current?.info.author ?? null,
        duration: player.current?.info.length ?? 0,
        position: player.player.position,
        queueLength: player.queue.length,
        upcoming: player.queue.slice(0, UPCOMING_LIMIT).map((song, index) => ({
            position: index + 1,
            title: song.info.title,
            author: song.info.author,
            duration: song.info.isStream ? 0 : song.info.length,
        })),
        volume: player.volume,
        paused: player.paused,
        loop: player.loop,
        autoplay: player.autoplay,
        activeFilters: [...player.filters],
        filterValues: { ...player.filterValues },
    };
}

export function dashboardPlayer(
    client: BootstrapClient,
    guildId: string
): { found: boolean; player: PlayerSnapshot | null } {
    if (!client.guilds.cache.has(guildId)) return { found: false, player: null };
    return { found: true, player: playerSnapshot(client.queue.get(guildId)) };
}

function nextLoop(current: 'off' | 'repeat' | 'queue'): 'off' | 'repeat' | 'queue' {
    const index = LOOP_MODES.indexOf(current);
    return LOOP_MODES[(index + 1) % LOOP_MODES.length];
}

function requireVolume(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 200) {
        throw new Error('Volume must be 0–200');
    }
}

/**
 * Mutating endpoint used by every dashboard control. Validation happens here,
 * before touching the player, so an invalid request leaves playback untouched.
 */
export async function dashboardPlayerAction(
    client: BootstrapClient,
    guildId: string,
    action: string,
    value: number
): Promise<ActionError> {
    const player = client.queue.get(guildId);
    if (!player) return { ok: false, found: true, status: 404, error: 'No active player' };

    try {
        switch (action) {
            case 'toggle':
                player.pause();
                break;
            case 'next':
                await player.skip();
                break;
            case 'previous':
                player.previousTrack();
                break;
            case 'stop':
                player.stop();
                break;
            case 'leave':
                player.destroy();
                break;
            case 'shuffle':
                player.setShuffle();
                await player.persist();
                break;
            case 'loop':
                player.setLoop(nextLoop(player.loop));
                break;
            case 'volume':
                requireVolume(value);
                await player.player.setGlobalVolume(value);
                break;
            case 'jump':
                if (!Number.isInteger(value) || value < 1 || value > player.queue.length) {
                    throw new Error('Invalid queue position');
                }
                await player.skip(value);
                break;
            case 'seek': {
                const length = player.current?.info.length ?? 0;
                if (length <= 0) throw new Error('Cannot seek a live stream');
                if (!Number.isFinite(value) || value < 0 || value > length) {
                    throw new Error('Invalid seek position');
                }
                player.seek(Math.round(value));
                break;
            }
            default:
                throw new Error('Unknown player action');
        }
        return { ok: true, found: true };
    } catch (error) {
        return {
            ok: false,
            found: true,
            status: 400,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function dashboardFilter(
    client: BootstrapClient,
    guildId: string,
    id: string,
    enabled: boolean,
    value?: number
): FilterResult {
    const player = client.queue.get(guildId);
    if (!player) {
        return { found: false, active: [], status: 404, error: 'No active player' };
    }
    try {
        applyFilter(player, id, enabled, value);
    } catch (error) {
        return {
            found: true,
            active: [...player.filters],
            status: 400,
            error: error instanceof Error ? error.message : String(error),
        };
    }
    return { found: true, active: [...player.filters] };
}
