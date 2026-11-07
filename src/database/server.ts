

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import config from '../config.js';
import {
    AutoplaySetting,
    BotPresence,
    CollectionShare,
    CommandAlias,
    CommandMapping,
    Dj,
    GameScore,
    Guild,
    GuildSetting,
    PermissionRule,
    Playlist,
    PrismaClient,
    Profile,
    RecentTrack,
    Role,
    Session,
    SessionLease,
    Setup,
    Song,
    Stay,
    UserPrefix,
    VoiceListen,
    VoiceListenOptOut,
} from '../generated/prisma/client.js';

/**
 * Stable identity for a Lavalink track. `encoded` cannot be used: the Deezer
 * source embeds a per-search token in it, so two searches for the same track
 * produce different strings. The canonical URI is stable; identifier+source is
 * the fallback for entries without one.
 */
function trackKey(track: unknown): string | null {
    const info = (track as { info?: { uri?: string; identifier?: string; sourceName?: string } })
        ?.info;
    if (!info) return null;
    if (info.uri) return info.uri;
    if (info.identifier && info.sourceName) return `${info.sourceName}:${info.identifier}`;
    const encoded = (track as { encoded?: string })?.encoded;
    return encoded ?? null;
}

/** Prisma 7 requires a driver adapter; the path is relative to the cwd. */
function createPrismaClient(): PrismaClient {
    const url = process.env.DATABASE_URL || 'file:./prisma/bootstrapdj.db';
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

export interface StatsPruneResult {
    daily: number;
    tracks: number;
    listeners: number;
    userTracks: number;
    leases: number;
}

export default class ServerData {
    private prisma: PrismaClient;
    /** PRAGMAs are connection/file scoped; every bot process runs this once. */
    private initPromise: Promise<void> | null = null;
    /** Guild rows are read for every message and every command; cache them and
     * invalidate on write (single-process bot, so no cross-process staleness). */
    private guildCache = new Map<string, Guild>();
    private setupCache = new Map<string, Setup | null>();
    /** Per-guild settings are read on every message/command; cache briefly and
     * invalidate on writes. Other bot processes may write too, so use a TTL
     * rather than treating the cache as authoritative. */
    private settingsCache = new Map<string, { at: number; data: Record<string, string> }>();

    constructor(prisma?: PrismaClient) {
        // Injectable so tests can pass a client wired to a throwaway SQLite
        // file instead of the tracked database file.
        this.prisma = prisma ?? createPrismaClient();
    }

    /**
     * Enable SQLite's concurrent-reader mode. WAL is stored in the database
     * file, so setting it once is enough; busy_timeout and synchronous are
     * per-connection and must be set by every bot process.
     */
    public async initialize(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = (async () => {
                await this.prisma.$queryRawUnsafe('PRAGMA busy_timeout = 10000');
                await this.prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
                await this.prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
            })().catch(error => {
                this.initPromise = null;
                throw error;
            });
        }
        await this.initPromise;
    }

    /**
     * Bound statistics growth. Daily rollups are pruned to the dashboard's
     * maximum range. Inactive track/listener rows are pruned, but the top 100
     * per guild are always kept so all-time leaderboards survive.
     */
    public async pruneStats(options: {
        now?: Date;
        retentionDays?: number;
        inactiveDays?: number;
    } = {}): Promise<StatsPruneResult> {
        const now = options.now ?? new Date();
        const retentionDays = options.retentionDays ?? config.statsRetentionDays;
        const inactiveDays = options.inactiveDays ?? config.statsInactiveDays;
        const result: StatsPruneResult = { daily: 0, tracks: 0, listeners: 0, userTracks: 0, leases: 0 };

        if (retentionDays > 0) {
            const cutoffDay = new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - retentionDays)
            )
                .toISOString()
                .slice(0, 10);
            result.daily = (await this.prisma.statsDaily.deleteMany({ where: { day: { lt: cutoffDay } } })).count;
        }

        if (inactiveDays > 0) {
            const cutoff = new Date(now.getTime() - inactiveDays * 86_400_000);
            result.tracks = await this.pruneInactiveTracks(cutoff);
            result.listeners = await this.pruneInactiveListeners(cutoff);
            result.userTracks = await this.pruneInactiveUserTracks(cutoff);
        }

        result.leases = (
            await this.prisma.sessionLease.deleteMany({ where: { expiresAt: { lt: now } } })
        ).count;
        return result;
    }

    private async pruneInactiveTracks(cutoff: Date): Promise<number> {
        const guilds = await this.prisma.statsTrack.findMany({
            select: { guildId: true },
            distinct: ['guildId'],
        });
        let removed = 0;
        for (const { guildId } of guilds) {
            const keep = await this.prisma.statsTrack.findMany({
                where: { guildId },
                orderBy: { seconds: 'desc' },
                take: 100,
                select: { trackId: true },
            });
            const removedForGuild = await this.prisma.statsTrack.deleteMany({
                where: {
                    guildId,
                    lastPlayed: { lt: cutoff },
                    ...(keep.length ? { trackId: { notIn: keep.map(row => row.trackId) } } : {}),
                },
            });
            removed += removedForGuild.count;
        }
        return removed;
    }

    private async pruneInactiveListeners(cutoff: Date): Promise<number> {
        const guilds = await this.prisma.statsListener.findMany({
            select: { guildId: true },
            distinct: ['guildId'],
        });
        let removed = 0;
        for (const { guildId } of guilds) {
            const keep = await this.prisma.statsListener.findMany({
                where: { guildId },
                orderBy: { seconds: 'desc' },
                take: 100,
                select: { userId: true },
            });
            const removedForGuild = await this.prisma.statsListener.deleteMany({
                where: {
                    guildId,
                    lastSeen: { lt: cutoff },
                    ...(keep.length ? { userId: { notIn: keep.map(row => row.userId) } } : {}),
                },
            });
            removed += removedForGuild.count;
        }
        return removed;
    }

    private async pruneInactiveUserTracks(cutoff: Date): Promise<number> {
        const guilds = await this.prisma.statsUserTrack.findMany({
            select: { guildId: true },
            distinct: ['guildId'],
        });
        let removed = 0;
        for (const { guildId } of guilds) {
            const keep = await this.prisma.statsUserTrack.findMany({
                where: { guildId },
                orderBy: { plays: 'desc' },
                take: 100,
                select: { userId: true, trackId: true },
            });
            const removedForGuild = await this.prisma.statsUserTrack.deleteMany({
                where: {
                    guildId,
                    lastPlayed: { lt: cutoff },
                    ...(keep.length
                        ? {
                              NOT: {
                                  OR: keep.map(row => ({
                                      userId: row.userId,
                                      trackId: row.trackId,
                                  })),
                              },
                          }
                        : {}),
                },
            });
            removed += removedForGuild.count;
        }
        return removed;
    }

    public async get(guildId: string): Promise<Guild | null> {
        const cached = this.guildCache.get(guildId);
        if (cached) return cached;
        const data = await this.prisma.guild.upsert({
            where: { guildId },
            update: {},
            create: {
                guildId,
                prefix: config.prefix,
            },
        });
        this.guildCache.set(guildId, data);
        return data;
    }

    public async setPrefix(guildId: string, prefix: string): Promise<void> {
        await this.prisma.guild.upsert({
            where: {
                guildId,
            },
            update: {
                prefix,
            },
            create: {
                guildId,
                prefix,
            },
        });
        this.guildCache.delete(guildId);
    }

    public async set_247(guildId: string, textId: string, voiceId: string): Promise<void> {
        await this.prisma.stay.upsert({
            where: {
                guildId,
            },
            update: {
                textId,
                voiceId,
            },
            create: {
                guildId,
                textId,
                voiceId,
            },
        });
    }

    public async delete_247(guildId: string): Promise<void> {
        await this.prisma.stay.delete({
            where: {
                guildId,
            },
        });
    }

    public async setDj(guildId: string, mode: boolean): Promise<void> {
        await this.prisma.dj.upsert({
            where: {
                guildId,
            },
            update: {
                mode,
            },
            create: {
                guildId,
                mode,
            },
        });
    }

    public async getCommandMapping(
        guildId: string,
        trigger: string,
        userId: string
    ): Promise<CommandMapping | null> {
        const rows = await this.prisma.commandMapping.findMany({
            where: {
                guildId,
                trigger,
                OR: [{ scope: 'server' }, { scope: 'user', userId }],
            },
            take: 2,
        });
        return rows.find(row => row.scope === 'server') ?? rows[0] ?? null;
    }

    public async setCommandMapping(
        guildId: string,
        scope: 'server' | 'user',
        userId: string,
        trigger: string,
        expansion: string
    ): Promise<CommandMapping> {
        return await this.prisma.commandMapping.upsert({
            where: { guildId_scope_userId_trigger: { guildId, scope, userId, trigger } },
            create: { guildId, scope, userId, trigger, expansion },
            update: { expansion },
        });
    }

    public async deleteCommandMapping(
        guildId: string,
        scope: 'server' | 'user',
        userId: string,
        trigger: string
    ): Promise<boolean> {
        const result = await this.prisma.commandMapping.deleteMany({
            where: { guildId, scope, userId, trigger },
        });
        return result.count > 0;
    }

    public async listCommandMappings(guildId: string, userId: string): Promise<CommandMapping[]> {
        return await this.prisma.commandMapping.findMany({
            where: { guildId, OR: [{ scope: 'server' }, { scope: 'user', userId }] },
            orderBy: { trigger: 'asc' },
        });
    }

    public async clearCommandMappings(
        guildId: string,
        scope: 'server' | 'user',
        userId: string
    ): Promise<number> {
        const result = await this.prisma.commandMapping.deleteMany({ where: { guildId, scope, userId } });
        return result.count;
    }

    public async getCommandAlias(
        guildId: string,
        alias: string,
        userId: string
    ): Promise<CommandAlias | null> {
        const rows = await this.prisma.commandAlias.findMany({
            where: {
                guildId,
                alias,
                OR: [{ scope: 'server' }, { scope: 'user', userId }],
            },
            take: 2,
        });
        return rows.find(row => row.scope === 'server') ?? rows[0] ?? null;
    }

    public async setCommandAlias(
        guildId: string,
        scope: 'server' | 'user',
        userId: string,
        alias: string,
        command: string
    ): Promise<CommandAlias> {
        return await this.prisma.commandAlias.upsert({
            where: { guildId_scope_userId_alias: { guildId, scope, userId, alias } },
            create: { guildId, scope, userId, alias, command },
            update: { command },
        });
    }

    public async deleteCommandAlias(
        guildId: string,
        scope: 'server' | 'user',
        userId: string,
        alias: string
    ): Promise<boolean> {
        const result = await this.prisma.commandAlias.deleteMany({
            where: { guildId, scope, userId, alias },
        });
        return result.count > 0;
    }

    public async listCommandAliases(guildId: string, userId: string): Promise<CommandAlias[]> {
        return await this.prisma.commandAlias.findMany({
            where: { guildId, OR: [{ scope: 'server' }, { scope: 'user', userId }] },
            orderBy: { alias: 'asc' },
        });
    }

    public async clearCommandAliases(
        guildId: string,
        scope: 'server' | 'user',
        userId: string
    ): Promise<number> {
        const result = await this.prisma.commandAlias.deleteMany({ where: { guildId, scope, userId } });
        return result.count;
    }

    public async getPermissionRules(guildId: string, command?: string): Promise<PermissionRule[]> {
        return await this.prisma.permissionRule.findMany({
            where: command ? { guildId, command } : { guildId },
            orderBy: { command: 'asc' },
        });
    }

    public async setPermissionRule(
        guildId: string,
        command: string,
        targetId: string,
        targetType: string,
        allow: boolean
    ): Promise<PermissionRule> {
        return await this.prisma.permissionRule.upsert({
            where: {
                guildId_command_targetId_targetType: { guildId, command, targetId, targetType },
            },
            create: { guildId, command, targetId, targetType, allow },
            update: { allow },
        });
    }

    public async clearPermissionRules(guildId: string, command?: string): Promise<number> {
        const result = await this.prisma.permissionRule.deleteMany({
            where: command ? { guildId, command } : { guildId },
        });
        return result.count;
    }

    public async isCommandAllowed(
        guildId: string,
        command: string,
        userId: string,
        roleIds: string[]
    ): Promise<boolean> {
        const rules = await this.getPermissionRules(guildId, command);
        if (!rules.length) return true;
        const matches = rules.filter(rule =>
            rule.targetType === 'user' ? rule.targetId === userId : roleIds.includes(rule.targetId)
        );
        if (!matches.length) return true;
        const allowed = matches.some(rule => rule.allow);
        const denied = matches.some(rule => !rule.allow);
        return allowed || !denied;
    }

    public async incrementGameScore(guildId: string, userId: string, win: boolean): Promise<GameScore> {
        return await this.prisma.gameScore.upsert({
            where: { guildId_userId: { guildId, userId } },
            create: { guildId, userId, wins: win ? 1 : 0, plays: 1 },
            update: { wins: { increment: win ? 1 : 0 }, plays: { increment: 1 } },
        });
    }

    public async getGameLeaderboard(guildId: string, limit: number = 10): Promise<GameScore[]> {
        return await this.prisma.gameScore.findMany({
            where: { guildId },
            orderBy: [{ wins: 'desc' }, { plays: 'asc' }],
            take: limit,
        });
    }

    public async heartbeatBot(botId: string, name: string): Promise<BotPresence> {
        return await this.prisma.botPresence.upsert({
            where: { botId },
            create: { botId, name, lastSeen: new Date() },
            update: { name, lastSeen: new Date() },
        });
    }

    public async getBotPresence(botId: string): Promise<BotPresence | null> {
        return await this.prisma.botPresence.findUnique({ where: { botId } });
    }

    /** Atomically claim a guild's voice session for this bot. A live lease held
     * by another bot is respected; an expired or same-bot lease is renewable. */
    public async claimSessionLease(
        guildId: string,
        botId: string,
        botName: string,
        ttlMs: number = 60_000
    ): Promise<boolean> {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlMs);
        try {
            return await this.prisma.$transaction(async tx => {
                const lease = await tx.sessionLease.findUnique({ where: { guildId } });
                if (
                    lease &&
                    lease.botId !== botId &&
                    lease.expiresAt.getTime() > now.getTime()
                ) {
                    return false;
                }
                await tx.sessionLease.upsert({
                    where: { guildId },
                    create: { guildId, botId, botName, expiresAt },
                    update: { botId, botName, expiresAt },
                });
                return true;
            });
        } catch {
            // SQLite can report a busy transaction under a simultaneous claim;
            // the next heartbeat retries instead of crashing playback.
            return false;
        }
    }

    public async getSessionLease(guildId: string): Promise<SessionLease | null> {
        return await this.prisma.sessionLease.findUnique({ where: { guildId } });
    }

    public async releaseSessionLease(guildId: string, botId: string): Promise<void> {
        await this.prisma.sessionLease.deleteMany({ where: { guildId, botId } });
    }

    public async recordRecentTrack(
        guildId: string,
        payload: string,
        title: string,
        author: string,
        uri: string | null,
        requesterId: string | null
    ): Promise<void> {
        await this.prisma.recentTrack.create({
            data: { guildId, payload, title, author, uri, requesterId },
        });
        const cutoff = await this.prisma.recentTrack.findFirst({
            where: { guildId },
            orderBy: { id: 'desc' },
            skip: 100,
            select: { id: true },
        });
        if (cutoff) {
            await this.prisma.recentTrack.deleteMany({
                where: { guildId, id: { lt: cutoff.id } },
            });
        }
    }

    public async getRecentTracks(guildId: string, limit: number): Promise<RecentTrack[]> {
        return await this.prisma.recentTrack.findMany({
            where: { guildId },
            orderBy: { playedAt: 'desc' },
            take: limit,
        });
    }

    public async getUserPrefix(guildId: string, userId: string): Promise<string | null> {
        const row = await this.prisma.userPrefix.findUnique({
            where: { guildId_userId: { guildId, userId } },
        });
        return row?.prefix ?? null;
    }

    public async setUserPrefix(guildId: string, userId: string, prefix: string): Promise<UserPrefix> {
        return await this.prisma.userPrefix.upsert({
            where: { guildId_userId: { guildId, userId } },
            create: { guildId, userId, prefix },
            update: { prefix },
        });
    }

    public async resetUserPrefix(guildId: string, userId: string): Promise<boolean> {
        const result = await this.prisma.userPrefix.deleteMany({ where: { guildId, userId } });
        return result.count > 0;
    }

    public async getProfile(userId: string): Promise<Profile | null> {
        return await this.prisma.profile.findUnique({ where: { userId } });
    }

    public async setProfile(
        userId: string,
        data: {
            color?: string | null;
            bio?: string | null;
            background?: string | null;
            avatarShape?: string | null;
            avatarBorder?: string | null;
            privacy?: string;
            visible?: boolean;
            serverVisible?: boolean;
        }
    ): Promise<Profile> {
        return await this.prisma.profile.upsert({
            where: { userId },
            create: { userId, ...data },
            update: data,
        });
    }

    public async recordTrackPlay(
        guildId: string,
        trackId: string,
        title: string,
        author: string,
        source: string,
        seconds: number,
        uri: string | null = null,
        requesterId: string | null = null
    ): Promise<void> {
        const value = Math.max(0, Math.round(seconds));
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        const writes = [
            this.prisma.statsTrack.upsert({
                where: { guildId_trackId: { guildId, trackId } },
                create: { guildId, trackId, title, author, source, uri, seconds: value, plays: 1 },
                update: { title, author, source, uri, seconds: { increment: value }, plays: { increment: 1 } },
            }),
            this.prisma.statsDaily.upsert({
                where: { guildId_day: { guildId, day } },
                create: { guildId, day, seconds: value, sessions: 1 },
                update: { seconds: { increment: value }, sessions: { increment: 1 } },
            }),
            this.prisma.statsHour.upsert({
                where: { guildId_hour: { guildId, hour: now.getUTCHours() } },
                create: { guildId, hour: now.getUTCHours(), seconds: value },
                update: { seconds: { increment: value } },
            }),
            this.prisma.statsWeekday.upsert({
                where: { guildId_weekday: { guildId, weekday: now.getUTCDay() } },
                create: { guildId, weekday: now.getUTCDay(), seconds: value },
                update: { seconds: { increment: value } },
            }),
        ];
        if (requesterId) {
            writes.push(
                this.prisma.statsUserTrack.upsert({
                    where: {
                        guildId_userId_trackId: { guildId, userId: requesterId, trackId },
                    },
                    create: { guildId, userId: requesterId, trackId, title, author, source, uri, seconds: value, plays: 1 },
                    update: {
                        title,
                        author,
                        source,
                        uri,
                        seconds: { increment: value },
                        plays: { increment: 1 },
                    },
                })
            );
        }
        await this.prisma.$transaction(writes);
    }

    public async recordListenerStatsBulk(
        guildId: string,
        rows: Array<{ userId: string; seconds: number; deafSeconds: number }>
    ): Promise<void> {
        if (!rows.length) return;
        await this.prisma.$transaction(
            rows.map(row =>
                this.prisma.statsListener.upsert({
                    where: { guildId_userId: { guildId, userId: row.userId } },
                    create: { guildId, userId: row.userId, seconds: row.seconds, deafSeconds: row.deafSeconds },
                    update: {
                        seconds: { increment: row.seconds },
                        deafSeconds: { increment: row.deafSeconds },
                    },
                })
            )
        );
    }

    public async recordCommand(guildId: string, command: string): Promise<void> {
        await this.prisma.statsCommand.upsert({
            where: { guildId_command: { guildId, command } },
            create: { guildId, command, count: 1 },
            update: { count: { increment: 1 } },
        });
    }

    public async recordGameSession(guildId: string): Promise<void> {
        const day = new Date().toISOString().slice(0, 10);
        await this.prisma.statsDaily.upsert({
            where: { guildId_day: { guildId, day } },
            create: { guildId, day, gameSessions: 1 },
            update: { gameSessions: { increment: 1 } },
        });
    }

    public async clearStats(guildId: string): Promise<number> {
        const results = await this.prisma.$transaction([
            this.prisma.statsTrack.deleteMany({ where: { guildId } }),
            this.prisma.statsListener.deleteMany({ where: { guildId } }),
            this.prisma.statsUserTrack.deleteMany({ where: { guildId } }),
            this.prisma.statsCommand.deleteMany({ where: { guildId } }),
            this.prisma.statsDaily.deleteMany({ where: { guildId } }),
            this.prisma.statsHour.deleteMany({ where: { guildId } }),
            this.prisma.statsWeekday.deleteMany({ where: { guildId } }),
            this.prisma.gameScore.deleteMany({ where: { guildId } }),
        ]);
        return results.reduce((sum, result) => sum + result.count, 0);
    }

    public async getStats(guildId: string, days: number = 7): Promise<Record<string, unknown>> {
        const dayKeys: string[] = [];
        const now = new Date();
        for (let offset = days - 1; offset >= 0; offset--) {
            const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
            dayKeys.push(date.toISOString().slice(0, 10));
        }
        const [daily, topTracks, topListeners, topCommands, sources, hours, weekdays] = await Promise.all([
            this.prisma.statsDaily.findMany({ where: { guildId, day: { in: dayKeys } } }),
            this.prisma.statsTrack.findMany({ where: { guildId }, orderBy: { seconds: 'desc' }, take: 5 }),
            this.prisma.statsListener.findMany({ where: { guildId }, orderBy: { seconds: 'desc' }, take: 5 }),
            this.prisma.statsCommand.findMany({ where: { guildId }, orderBy: { count: 'desc' }, take: 5 }),
            this.prisma.statsTrack.groupBy({ by: ['source'], where: { guildId }, _sum: { seconds: true, plays: true } }),
            this.prisma.statsHour.findMany({ where: { guildId }, orderBy: { hour: 'asc' } }),
            this.prisma.statsWeekday.findMany({ where: { guildId }, orderBy: { weekday: 'asc' } }),
        ]);
        const dailyMap = new Map(daily.map(entry => [entry.day, entry]));
        return {
            days: dayKeys.map(day => ({
                day,
                seconds: dailyMap.get(day)?.seconds ?? 0,
                sessions: dailyMap.get(day)?.sessions ?? 0,
                gameSessions: dailyMap.get(day)?.gameSessions ?? 0,
            })),
            totals: {
                seconds: daily.reduce((sum, entry) => sum + entry.seconds, 0),
                sessions: daily.reduce((sum, entry) => sum + entry.sessions, 0),
                gameSessions: daily.reduce((sum, entry) => sum + entry.gameSessions, 0),
            },
            sources: sources.map(entry => ({
                source: entry.source,
                seconds: entry._sum.seconds ?? 0,
                plays: entry._sum.plays ?? 0,
            })),
            topTracks: topTracks.map(entry => ({
                title: entry.title,
                author: entry.author,
                source: entry.source,
                uri: entry.uri,
                seconds: entry.seconds,
                plays: entry.plays,
            })),
            topListeners: topListeners.map(entry => ({
                userId: entry.userId,
                seconds: entry.seconds,
                deafSeconds: entry.deafSeconds,
            })),
            topCommands: topCommands.map(entry => ({ command: entry.command, count: entry.count })),
            hours: Array.from({ length: 24 }, (_, hour) => ({
                hour,
                seconds: hours.find(entry => entry.hour === hour)?.seconds ?? 0,
            })),
            weekdays: Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                seconds: weekdays.find(entry => entry.weekday === weekday)?.seconds ?? 0,
            })),
        };
    }

    /** Self-only personal statistics used by the dashboard. */
    public async getUserStats(
        guildId: string,
        userId: string
    ): Promise<{
        listenedSeconds: number;
        deafSeconds: number;
        totalPlays: number;
        totalSeconds: number;
        uniqueTracks: number;
        tracks: Array<{
            title: string;
            author: string;
            source: string;
            uri: string | null;
            plays: number;
            seconds: number;
            lastPlayed: Date;
        }>;
    }> {
        const [listener, tracks] = await Promise.all([
            this.prisma.statsListener.findUnique({
                where: { guildId_userId: { guildId, userId } },
            }),
            this.prisma.statsUserTrack.findMany({
                where: { guildId, userId },
                orderBy: { plays: 'desc' },
                take: 100,
            }),
        ]);
        return {
            listenedSeconds: listener?.seconds ?? 0,
            deafSeconds: listener?.deafSeconds ?? 0,
            totalPlays: tracks.reduce((sum, row) => sum + row.plays, 0),
            totalSeconds: tracks.reduce((sum, row) => sum + row.seconds, 0),
            uniqueTracks: tracks.length,
            tracks: tracks.slice(0, 20).map(row => ({
                title: row.title,
                author: row.author,
                source: row.source,
                uri: row.uri,
                plays: row.plays,
                seconds: row.seconds,
                lastPlayed: row.lastPlayed,
            })),
        };
    }

    public async getGuildSettings(guildId: string): Promise<Record<string, string>> {
        const cached = this.settingsCache.get(guildId);
        if (cached && Date.now() - cached.at < 5000) return cached.data;
        const rows = await this.prisma.guildSetting.findMany({ where: { guildId } });
        const data = Object.fromEntries(rows.map((row: GuildSetting) => [row.key, row.value]));
        this.settingsCache.set(guildId, { at: Date.now(), data });
        return data;
    }

    public async getGuildSetting(guildId: string, key: string): Promise<string | null> {
        const settings = await this.getGuildSettings(guildId);
        return settings[key] ?? null;
    }

    public async setGuildSetting(guildId: string, key: string, value: string): Promise<GuildSetting> {
        const row = await this.prisma.guildSetting.upsert({
            where: { guildId_key: { guildId, key } },
            create: { guildId, key, value },
            update: { value },
        });
        this.settingsCache.delete(guildId);
        return row;
    }

    public async resetGuildSettings(guildId: string): Promise<number> {
        const result = await this.prisma.guildSetting.deleteMany({ where: { guildId } });
        this.settingsCache.delete(guildId);
        return result.count;
    }

    public async getAutoplaySetting(guildId: string): Promise<AutoplaySetting | null> {
        return await this.prisma.autoplaySetting.findUnique({ where: { guildId } });
    }

    public async setAutoplaySetting(
        guildId: string,
        data: { source: string; seeds: string }
    ): Promise<AutoplaySetting> {
        return await this.prisma.autoplaySetting.upsert({
            where: { guildId },
            update: data,
            create: { guildId, ...data },
        });
    }

    public async deleteAutoplaySetting(guildId: string): Promise<void> {
        await this.prisma.autoplaySetting.deleteMany({ where: { guildId } });
    }

    public async get_247(guildId?: string): Promise<Stay | Stay[] | null> {
        if (guildId) {
            return await this.prisma.stay.findUnique({
                where: {
                    guildId,
                },
            });
        } else {
            return await this.prisma.stay.findMany();
        }
    }

    public async getVoiceListen(guildId: string): Promise<VoiceListen | null> {
        return await this.prisma.voiceListen.findUnique({ where: { guildId } });
    }

    public async setVoiceListen(
        guildId: string,
        data: {
            enabled: boolean;
            voiceChannelId?: string | null;
            textChannelId?: string | null;
            updatedBy?: string | null;
        }
    ): Promise<VoiceListen> {
        return await this.prisma.voiceListen.upsert({
            where: { guildId },
            create: {
                guildId,
                enabled: data.enabled,
                voiceChannelId: data.voiceChannelId ?? null,
                textChannelId: data.textChannelId ?? null,
                updatedBy: data.updatedBy ?? null,
            },
            update: {
                enabled: data.enabled,
                voiceChannelId: data.voiceChannelId ?? null,
                textChannelId: data.textChannelId ?? null,
                updatedBy: data.updatedBy ?? null,
            },
        });
    }

    public async addVoiceOptOut(guildId: string, userId: string): Promise<VoiceListenOptOut> {
        return await this.prisma.voiceListenOptOut.upsert({
            where: { guildId_userId: { guildId, userId } },
            create: { guildId, userId },
            update: {},
        });
    }

    public async removeVoiceOptOut(guildId: string, userId: string): Promise<boolean> {
        const result = await this.prisma.voiceListenOptOut.deleteMany({
            where: { guildId, userId },
        });
        return result.count > 0;
    }

    public async listVoiceOptOuts(guildId: string): Promise<VoiceListenOptOut[]> {
        return await this.prisma.voiceListenOptOut.findMany({ where: { guildId } });
    }

    public async getDj(guildId: string): Promise<Dj | null> {
        return await this.prisma.dj.findUnique({
            where: {
                guildId,
            },
        });
    }

    public async getRoles(guildId: string): Promise<Role[]> {
        return await this.prisma.role.findMany({
            where: {
                guildId,
            },
        });
    }

    public async addRole(guildId: string, roleId: string): Promise<void> {
        await this.prisma.role.upsert({
            where: {
                guildId_roleId: {
                    guildId,
                    roleId,
                },
            },
            update: {},
            create: {
                guildId,
                roleId,
            },
        });
    }

    public async removeRole(guildId: string, roleId: string): Promise<void> {
        await this.prisma.role.delete({
            where: {
                guildId_roleId: {
                    guildId,
                    roleId,
                },
            },
        });
    }

    public async clearRoles(guildId: string): Promise<void> {
        await this.prisma.role.deleteMany({
            where: {
                guildId,
            },
        });
    }

    public async getSetup(guildId: string): Promise<Setup | null> {
        if (this.setupCache.has(guildId)) return this.setupCache.get(guildId) ?? null;
        const setup = await this.prisma.setup.findUnique({
            where: {
                guildId,
            },
        });
        this.setupCache.set(guildId, setup);
        return setup;
    }

    public async getSetups(): Promise<Setup[]> {
        const setups = await this.prisma.setup.findMany();
        for (const setup of setups) this.setupCache.set(setup.guildId, setup);
        return setups;
    }

    public async setSetup(guildId: string, textId: string, messageId: string): Promise<void> {
        await this.prisma.setup.upsert({
            where: {
                guildId,
            },
            update: {
                textId,
                messageId,
            },
            create: {
                guildId,
                textId,
                messageId,
            },
        });
        this.setupCache.delete(guildId);
    }

    public async deleteSetup(guildId: string): Promise<void> {
        await this.prisma.setup.delete({
            where: {
                guildId,
            },
        });
        this.setupCache.set(guildId, null);
    }

    /** Save (or refresh) the guild's playback state for restart recovery. */
    public async saveSession(session: {
        guildId: string;
        textId: string;
        voiceId: string;
        current: string | null;
        queue: string;
        loop: string;
        autoplay: boolean;
        volume: number;
        paused: boolean;
    }): Promise<void> {
        await this.prisma.session.upsert({
            where: { guildId: session.guildId },
            update: session,
            create: session,
        });
    }

    public async getSessions(): Promise<Session[]> {
        return await this.prisma.session.findMany();
    }

    /** Watchdog discovery only needs ids; avoid loading every saved queue JSON. */
    public async getSessionGuildIds(): Promise<string[]> {
        const rows = await this.prisma.session.findMany({ select: { guildId: true } });
        return rows.map(row => row.guildId);
    }

    public async getSession(guildId: string): Promise<Session | null> {
        return await this.prisma.session.findUnique({ where: { guildId } });
    }

    public async deleteSession(guildId: string): Promise<void> {
        // deleteMany: a missing row is not an error here.
        await this.prisma.session.deleteMany({ where: { guildId } });
    }

    public async getPLaylist(userId: string, name: string): Promise<Playlist | null> {
        return await this.prisma.playlist.findUnique({
            where: {
                userId_name: {
                    userId,
                    name,
                },
            },
        });
    }

    public async getPlaylists(
        userId: string
    ): Promise<(Playlist & { _count: { songs: number } })[]> {
        return await this.prisma.playlist.findMany({
            where: { userId },
            orderBy: { name: 'asc' },
            include: { _count: { select: { songs: true } } },
        });
    }

    public async createPlaylist(userId: string, name: string): Promise<void> {
        await this.prisma.playlist.create({
            data: {
                userId,
                name,
            },
        });
    }

    public async deletePlaylist(userId: string, name: string): Promise<boolean> {
        const playlist = await this.getPLaylist(userId, name);
        if (!playlist) return false;
        // Song.playlistId has no ON DELETE CASCADE, so deleting the parent
        // throws P2003 while rows still reference it. Remove the children in
        // the same transaction, otherwise a partial failure leaves an orphaned
        // playlist that looks deleted to the caller.
        await this.prisma.$transaction([
            this.prisma.song.deleteMany({ where: { playlistId: playlist.id } }),
            this.prisma.playlist.delete({ where: { id: playlist.id } }),
        ]);
        return true;
    }

    public async addSong(userId: string, name: string, track: unknown): Promise<boolean> {
        const playlist = await this.prisma.playlist.upsert({
            where: { userId_name: { userId, name } },
            create: { userId, name },
            update: {},
        });
        // Compare on the canonical track identity; see trackKey().
        const key = trackKey(track);
        if (key) {
            const rows = await this.prisma.song.findMany({
                where: { playlistId: playlist.id },
                select: { track: true },
            });
            const duplicate = rows.some(row => {
                try {
                    const parsed = JSON.parse(row.track);
                    const entries = Array.isArray(parsed) ? parsed : [parsed];
                    return entries.some(entry => trackKey(entry) === key);
                } catch {
                    return false;
                }
            });
            if (duplicate) return false;
        }
        try {
            await this.prisma.song.create({
                data: {
                    track: JSON.stringify(track),
                    playlistId: playlist.id,
                },
            });
        } catch (error) {
            if ((error as { code?: string }).code === 'P2002') return false;
            throw error;
        }
        return true;
    }

    /** Remove the row containing the track identified by its canonical key.
     * Rows store a JSON blob, and legacy rows may contain an array, so an exact
     * `track: song` delete can miss a re-searched version of the same song. */
    public async removeSong(userId: string, name: string, songKey: string): Promise<boolean> {
        const playlist = await this.getPLaylist(userId, name);
        if (!playlist) return false;
        const rows = await this.prisma.song.findMany({
            where: { playlistId: playlist.id },
            select: { id: true, track: true },
        });
        const row = rows.find(candidate => {
            try {
                const parsed = JSON.parse(candidate.track);
                const entries = Array.isArray(parsed) ? parsed : [parsed];
                return entries.some(entry => trackKey(entry) === songKey);
            } catch {
                return candidate.track === songKey;
            }
        });
        if (!row) return false;
        await this.prisma.song.delete({ where: { id: row.id } });
        return true;
    }

    public async getSong(userId: string, name: string): Promise<Song[]> {
        const playlist = await this.getPLaylist(userId, name);
        if (playlist) {
            const songs = await this.prisma.song.findMany({
                where: {
                    playlistId: playlist.id,
                },
                orderBy: { id: 'asc' },
            });
            return songs;
        }
        return [];
    }

    public async createCollectionShare(ownerId: string, name: string, code: string): Promise<CollectionShare> {
        return await this.prisma.collectionShare.create({ data: { code, ownerId, name } });
    }

    public async getCollectionShare(code: string): Promise<CollectionShare | null> {
        return await this.prisma.collectionShare.findUnique({ where: { code } });
    }

    public async deleteCollectionShare(ownerId: string, code: string): Promise<boolean> {
        const result = await this.prisma.collectionShare.deleteMany({ where: { code, ownerId } });
        return result.count > 0;
    }

    public async listCollectionShares(ownerId: string): Promise<CollectionShare[]> {
        return await this.prisma.collectionShare.findMany({
            where: { ownerId },
            orderBy: { createdAt: 'desc' },
        });
    }

    public async removeSongAt(userId: string, name: string, index: number): Promise<boolean> {
        const songs = await this.getSong(userId, name);
        const row = songs[index - 1];
        if (!row) return false;
        await this.prisma.song.delete({ where: { id: row.id } });
        return true;
    }

    public async clearPlaylist(userId: string, name: string): Promise<void> {
        const playlist = await this.getPLaylist(userId, name);
        if (playlist) {
            await this.prisma.song.deleteMany({
                where: {
                    playlistId: playlist.id,
                },
            });
        }
    }

}






