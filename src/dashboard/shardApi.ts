
import type Dispatcher from '../core/Dispatcher.js';
import type { BootstrapClient } from '../core/index.js';
import { PermissionFlagsBits } from 'discord.js';

import { applyFilter } from './filters.js';

export type GuildAccess = {
    member: boolean;
    owner: boolean;
    admin: boolean;
    controls: boolean;
    settings: boolean;
};

export const NO_ACCESS: GuildAccess = {
    member: false,
    owner: false,
    admin: false,
    controls: false,
    settings: false,
};
export const FULL_ACCESS: GuildAccess = {
    member: true,
    owner: true,
    admin: true,
    controls: true,
    settings: true,
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
}

export interface ActionError {
    ok: boolean;
    found: boolean;
    error?: string;
}

export async function guildAccessFor(
    client: BootstrapClient,
    userId: string | null,
    guildId: string
): Promise<AccessResult> {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { found: false, access: NO_ACCESS };
    if (!userId) return { found: true, access: FULL_ACCESS };

    const member =
        guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    if (!member) return { found: true, access: NO_ACCESS };
    const owner = guild.ownerId === userId;
    const admin = Boolean(
        owner ||
            member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            member.permissions.has(PermissionFlagsBits.Administrator)
    );
    const djRoles = await client.db.getRoles(guildId).catch(() => []);
    const controls = admin || djRoles.some(role => member.roles.cache.has(role.roleId));
    return {
        found: true,
        access: { member: true, owner, admin, controls, settings: admin },
    };
}

export async function dashboardGuilds(
    client: BootstrapClient,
    userId: string | null
): Promise<DashboardGuild[]> {
    const rows = await Promise.all(
        [...client.guilds.cache.values()].map(async guild => {
            const access = userId
                ? (await guildAccessFor(client, userId, guild.id)).access
                : FULL_ACCESS;
            return access.member
                ? {
                      id: guild.id,
                      name: guild.name,
                      ...access,
                  }
                : null;
        })
    );
    return rows.filter((row): row is DashboardGuild => row !== null);
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
        upcoming: player.queue.slice(0, 20).map((track, index) => ({
            position: index + 1,
            title: track.info.title,
            author: track.info.author,
            duration: track.info.isStream ? 0 : track.info.length,
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

export async function dashboardPlayerAction(
    client: BootstrapClient,
    guildId: string,
    action: string,
    value: number
): Promise<ActionError> {
    const player = client.queue.get(guildId);
    if (!player) return { ok: false, found: true, error: 'No active player' };
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
            case 'loop': {
                const loops: Array<'off' | 'repeat' | 'queue'> = ['off', 'repeat', 'queue'];
                const index = loops.indexOf(player.loop);
                player.setLoop(loops[(index + 1) % loops.length]);
                break;
            }
            case 'volume': {
                if (!Number.isFinite(value) || value < 0 || value > 200) {
                    throw new Error('Volume must be 0–200');
                }
                await player.player.setGlobalVolume(value);
                break;
            }
            case 'jump': {
                if (!Number.isInteger(value) || value < 1 || value > player.queue.length) {
                    throw new Error('Invalid queue position');
                }
                await player.skip(value);
                break;
            }
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
    if (!player) return { found: false, active: [] };
    applyFilter(player, id, enabled, value);
    return { found: true, active: [...player.filters] };
}
