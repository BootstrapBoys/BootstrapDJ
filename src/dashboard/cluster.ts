import type { Client } from 'discord.js';

import type { BootstrapClient } from '../core/index.js';
import {
    type AccessResult,
    type ActionError,
    type DashboardGuild,
    type FilterResult,
    NO_ACCESS,
    type PlayerSnapshot,
} from './shardApi.js';

/**
 * Shard fan-out for dashboard reads and mutations.
 *
 * `broadcastEval` serialises the callback and runs it inside each shard, so a
 * callback may only reference its arguments and globals — never helpers from
 * this module. Each callback therefore declares its own structural guard; TS
 * erases the guard's type annotation and the emitted function only performs one
 * property lookup per shard.
 *
 * Single-process deployments skip the broadcast and call the same local hooks,
 * so both modes share one implementation.
 */

const EMPTY_ACCESS: AccessResult = { found: false, access: NO_ACCESS };

export async function readAccess(
    client: BootstrapClient,
    userId: string | null,
    guildId: string
): Promise<AccessResult> {
    if (!client.shard) return await client.dashboardLocalAccess(userId, guildId);
    try {
        const values = await client.shard.broadcastEval(
            (shard, context) => {
                const host = (
                    value: Client
                ): value is Client & {
                    dashboardLocalAccess(
                        userId: string | null,
                        guildId: string
                    ): Promise<AccessResult>;
                } => typeof Reflect.get(value, 'dashboardLocalAccess') === 'function';
                if (!host(shard)) {
                    return {
                        found: false,
                        access: {
                            member: false,
                            owner: false,
                            admin: false,
                            controls: false,
                            settings: false,
                            listen: false,
                        },
                    };
                }
                return shard.dashboardLocalAccess(context.userId, context.guildId);
            },
            { context: { userId, guildId } }
        );
        return values.find(entry => entry.found) ?? EMPTY_ACCESS;
    } catch (error) {
        client.logger.warn(
            `[dashboard] access query failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return EMPTY_ACCESS;
    }
}

export async function remoteGuilds(
    client: BootstrapClient,
    userId: string | null
): Promise<DashboardGuild[]> {
    if (!client.shard) return await client.dashboardLocalGuilds(userId);
    try {
        const lists = await client.shard.broadcastEval(
            (shard, context) => {
                const host = (
                    value: Client
                ): value is Client & {
                    dashboardLocalGuilds(userId: string | null): Promise<DashboardGuild[]>;
                } => typeof Reflect.get(value, 'dashboardLocalGuilds') === 'function';
                return host(shard) ? shard.dashboardLocalGuilds(context.userId) : [];
            },
            { context: { userId } }
        );
        const seen = new Set<string>();
        const merged: DashboardGuild[] = [];
        for (const list of lists) {
            for (const guild of list) {
                if (seen.has(guild.id)) continue;
                seen.add(guild.id);
                merged.push(guild);
            }
        }
        return merged;
    } catch (error) {
        client.logger.warn(
            `[dashboard] guild query failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}

export async function remoteGuildIds(client: BootstrapClient): Promise<string[]> {
    if (!client.shard) return client.dashboardLocalGuildIds();
    try {
        const lists = await client.shard.broadcastEval(shard => {
            const host = (
                value: Client
            ): value is Client & {
                dashboardLocalGuildIds(): string[];
            } => typeof Reflect.get(value, 'dashboardLocalGuildIds') === 'function';
            return host(shard) ? shard.dashboardLocalGuildIds() : [];
        });
        return [...new Set(lists.flat())];
    } catch (error) {
        client.logger.warn(
            `[dashboard] guild id query failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}

export async function remotePlayer(
    client: BootstrapClient,
    guildId: string
): Promise<{ found: boolean; player: PlayerSnapshot | null }> {
    if (!client.shard) return client.dashboardLocalPlayer(guildId);
    try {
        const results = await client.shard.broadcastEval(
            (shard, context) => {
                const host = (
                    value: Client
                ): value is Client & {
                    dashboardLocalPlayer(guildId: string): {
                        found: boolean;
                        player: PlayerSnapshot | undefined;
                    };
                } => typeof Reflect.get(value, 'dashboardLocalPlayer') === 'function';
                if (!host(shard)) return { found: false, player: undefined };
                return shard.dashboardLocalPlayer(context.guildId);
            },
            { context: { guildId } }
        );
        const hit = results.find(entry => entry.found);
        if (!hit) return { found: false, player: null };
        return { found: true, player: hit.player ?? null };
    } catch (error) {
        client.logger.warn(
            `[dashboard] player query failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return { found: false, player: null };
    }
}

export async function remotePlayerAction(
    client: BootstrapClient,
    guildId: string,
    action: string,
    value: number
): Promise<ActionError> {
    if (!client.shard) return await client.dashboardLocalPlayerAction(guildId, action, value);
    const results = await client.shard.broadcastEval(
        (shard, context) => {
            const host = (
                value: Client
            ): value is Client & {
                dashboardLocalPlayerAction(
                    guildId: string,
                    action: string,
                    value: number
                ): Promise<ActionError>;
            } => typeof Reflect.get(value, 'dashboardLocalPlayerAction') === 'function';
            const miss: ActionError = {
                ok: false,
                found: false,
                status: 404,
                error: 'Unknown guild',
            };
            if (!host(shard)) return miss;
            return shard.dashboardLocalPlayerAction(context.guildId, context.action, context.value);
        },
        { context: { guildId, action, value } }
    );
    const hit = results.find(entry => entry.found);
    return hit ?? { ok: false, found: false, status: 404, error: 'Unknown guild' };
}

export async function remoteFilter(
    client: BootstrapClient,
    guildId: string,
    id: string,
    enabled: boolean,
    value?: number
): Promise<FilterResult> {
    if (!client.shard) return client.dashboardLocalFilter(guildId, id, enabled, value);
    const results = await client.shard.broadcastEval(
        (shard, context) => {
            const host = (
                value: Client
            ): value is Client & {
                dashboardLocalFilter(
                    guildId: string,
                    id: string,
                    enabled: boolean,
                    value?: number
                ): FilterResult;
            } => typeof Reflect.get(value, 'dashboardLocalFilter') === 'function';
            if (!host(shard)) {
                return {
                    found: false,
                    active: [],
                    status: 404,
                    error: 'No active player',
                };
            }
            return shard.dashboardLocalFilter(
                context.guildId,
                context.id,
                context.enabled,
                context.value
            );
        },
        { context: { guildId, id, enabled, value } }
    );
    return (
        results.find(entry => entry.found) ?? {
            found: false,
            active: [],
            status: 404,
            error: 'No active player',
        }
    );
}

/** Settings are cached per process; every shard must drop its copy. */
export async function clearSettingsCaches(client: BootstrapClient, guildId: string): Promise<void> {
    if (!client.shard) {
        client.clearGuildSettingsCache(guildId);
        return;
    }
    try {
        await client.shard.broadcastEval(
            (shard, context) => {
                const host = (
                    value: Client
                ): value is Client & {
                    clearGuildSettingsCache(guildId: string): void;
                } => typeof Reflect.get(value, 'clearGuildSettingsCache') === 'function';
                if (host(shard)) shard.clearGuildSettingsCache(context.guildId);
                return true;
            },
            { context: { guildId } }
        );
    } catch (error) {
        client.logger.warn(
            `[dashboard] settings cache invalidation failed: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}
