import type {
    BotPresence,
    PrismaClient,
    RecentTrack,
    Session,
    SessionLease,
} from '../generated/prisma/client.js';

/** Session leases, saved playback sessions, presence, and recent-track history. */
export class SessionStore {
    public constructor(private readonly prisma: PrismaClient) {}

    public async heartbeat(botId: string, name: string): Promise<BotPresence> {
        return await this.prisma.botPresence.upsert({
            where: { botId },
            create: { botId, name, lastSeen: new Date() },
            update: { name, lastSeen: new Date() },
        });
    }

    public async presence(botId: string): Promise<BotPresence | null> {
        return await this.prisma.botPresence.findUnique({ where: { botId } });
    }

    public async claim(guildId: string, botId: string, botName: string, ttlMs: number = 60_000): Promise<boolean> {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlMs);
        try {
            return await this.prisma.$transaction(async tx => {
                const lease = await tx.sessionLease.findUnique({ where: { guildId } });
                if (lease && lease.botId !== botId && lease.expiresAt.getTime() > now.getTime()) {
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
            // A busy SQLite write is retried by the next heartbeat.
            return false;
        }
    }

    public async lease(guildId: string): Promise<SessionLease | null> {
        return await this.prisma.sessionLease.findUnique({ where: { guildId } });
    }

    public async release(guildId: string, botId: string): Promise<void> {
        await this.prisma.sessionLease.deleteMany({ where: { guildId, botId } });
    }

    public async recordRecent(
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

    public async recent(guildId: string, limit: number): Promise<RecentTrack[]> {
        return await this.prisma.recentTrack.findMany({
            where: { guildId },
            orderBy: { playedAt: 'desc' },
            take: limit,
        });
    }

    public async save(session: {
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

    public async all(): Promise<Session[]> {
        return await this.prisma.session.findMany();
    }

    public async guildIds(): Promise<string[]> {
        const rows = await this.prisma.session.findMany({ select: { guildId: true } });
        return rows.map(row => row.guildId);
    }

    public async get(guildId: string): Promise<Session | null> {
        return await this.prisma.session.findUnique({ where: { guildId } });
    }

    public async remove(guildId: string): Promise<void> {
        await this.prisma.session.deleteMany({ where: { guildId } });
    }
}
