import config from '../config.js';
import type { GameScore, PrismaClient } from '../generated/prisma/client.js';
import { incrementCounter } from '../lib/PerformanceCounters.js';

export interface StatsPruneResult {
    daily: number;
    tracks: number;
    listeners: number;
    userTracks: number;
    leases: number;
}

/** Playback/listener statistics, game scores, and retention pruning. */
export class StatsStore {
    public constructor(protected readonly prisma: PrismaClient) {}

    public async pruneStats(
        options: {
            now?: Date;
            retentionDays?: number;
            inactiveDays?: number;
        } = {}
    ): Promise<StatsPruneResult> {
        const now = options.now ?? new Date();
        const retentionDays = options.retentionDays ?? config.statsRetentionDays;
        const inactiveDays = options.inactiveDays ?? config.statsInactiveDays;
        const result: StatsPruneResult = {
            daily: 0,
            tracks: 0,
            listeners: 0,
            userTracks: 0,
            leases: 0,
        };

        if (retentionDays > 0) {
            const cutoffDay = new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - retentionDays)
            )
                .toISOString()
                .slice(0, 10);
            result.daily = (
                await this.prisma.statsDaily.deleteMany({ where: { day: { lt: cutoffDay } } })
            ).count;
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

    public async incrementGameScore(
        guildId: string,
        userId: string,
        win: boolean
    ): Promise<GameScore> {
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
                update: {
                    title,
                    author,
                    source,
                    uri,
                    seconds: { increment: value },
                    plays: { increment: 1 },
                },
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
                    create: {
                        guildId,
                        userId: requesterId,
                        trackId,
                        title,
                        author,
                        source,
                        uri,
                        seconds: value,
                        plays: 1,
                    },
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
        await this.recordListenerStatsBatch(rows.map(row => ({ guildId, ...row })));
    }

    /** One transaction for every guild's sampled listeners. */
    public async recordListenerStatsBatch(
        rows: Array<{ guildId: string; userId: string; seconds: number; deafSeconds: number }>
    ): Promise<void> {
        if (!rows.length) return;
        const startedAt = Date.now();
        try {
            await this.prisma.$transaction(
                rows.map(row =>
                    this.prisma.statsListener.upsert({
                        where: { guildId_userId: { guildId: row.guildId, userId: row.userId } },
                        create: {
                            guildId: row.guildId,
                            userId: row.userId,
                            seconds: row.seconds,
                            deafSeconds: row.deafSeconds,
                        },
                        update: {
                            seconds: { increment: row.seconds },
                            deafSeconds: { increment: row.deafSeconds },
                        },
                    })
                )
            );
            incrementCounter('statsBatches');
            incrementCounter('statsRows', rows.length);
        } catch (error) {
            incrementCounter('statsErrors');
            throw error;
        } finally {
            incrementCounter('statsFlushMs', Date.now() - startedAt);
        }
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
            const date = new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)
            );
            dayKeys.push(date.toISOString().slice(0, 10));
        }
        const [daily, topTracks, topListeners, topCommands, sources, hours, weekdays] =
            await Promise.all([
                this.prisma.statsDaily.findMany({ where: { guildId, day: { in: dayKeys } } }),
                this.prisma.statsTrack.findMany({
                    where: { guildId },
                    orderBy: { seconds: 'desc' },
                    take: 5,
                }),
                this.prisma.statsListener.findMany({
                    where: { guildId },
                    orderBy: { seconds: 'desc' },
                    take: 5,
                }),
                this.prisma.statsCommand.findMany({
                    where: { guildId },
                    orderBy: { count: 'desc' },
                    take: 5,
                }),
                this.prisma.statsTrack.groupBy({
                    by: ['source'],
                    where: { guildId },
                    _sum: { seconds: true, plays: true },
                }),
                this.prisma.statsHour.findMany({ where: { guildId }, orderBy: { hour: 'asc' } }),
                this.prisma.statsWeekday.findMany({
                    where: { guildId },
                    orderBy: { weekday: 'asc' },
                }),
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
        const [listener, aggregate, tracks] = await Promise.all([
            this.prisma.statsListener.findUnique({
                where: { guildId_userId: { guildId, userId } },
            }),
            this.prisma.statsUserTrack.aggregate({
                where: { guildId, userId },
                _sum: { plays: true, seconds: true },
                _count: { trackId: true },
            }),
            this.prisma.statsUserTrack.findMany({
                where: { guildId, userId },
                orderBy: { plays: 'desc' },
                take: 20,
            }),
        ]);
        return {
            listenedSeconds: listener?.seconds ?? 0,
            deafSeconds: listener?.deafSeconds ?? 0,
            totalPlays: aggregate._sum.plays ?? 0,
            totalSeconds: aggregate._sum.seconds ?? 0,
            uniqueTracks: aggregate._count.trackId,
            tracks: tracks.map(row => ({
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
}
