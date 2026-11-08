import type { PrismaClient, Profile, UserPrefix } from '../generated/prisma/client.js';

/** Per-user server prefixes and dashboard profile rows. */
export class UserStore {
    public constructor(private readonly prisma: PrismaClient) {}

    public async prefix(guildId: string, userId: string): Promise<string | null> {
        const row = await this.prisma.userPrefix.findUnique({
            where: { guildId_userId: { guildId, userId } },
        });
        return row?.prefix ?? null;
    }

    public async setPrefix(guildId: string, userId: string, prefix: string): Promise<UserPrefix> {
        return await this.prisma.userPrefix.upsert({
            where: { guildId_userId: { guildId, userId } },
            create: { guildId, userId, prefix },
            update: { prefix },
        });
    }

    public async resetPrefix(guildId: string, userId: string): Promise<boolean> {
        const result = await this.prisma.userPrefix.deleteMany({ where: { guildId, userId } });
        return result.count > 0;
    }

    public async profile(userId: string): Promise<Profile | null> {
        return await this.prisma.profile.findUnique({ where: { userId } });
    }

    public async saveProfile(
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
}
