import type { PrismaClient, VoiceListen, VoiceListenOptOut } from '../generated/prisma/client.js';

/** Voice-listener enablement and per-member opt-outs. */
export class VoiceStore {
    public constructor(private readonly prisma: PrismaClient) {}

    public async get(guildId: string): Promise<VoiceListen | null> {
        return await this.prisma.voiceListen.findUnique({ where: { guildId } });
    }

    public async set(
        guildId: string,
        data: {
            enabled: boolean;
            voiceChannelId?: string | null;
            textChannelId?: string | null;
            updatedBy?: string | null;
        }
    ): Promise<VoiceListen> {
        const record = {
            enabled: data.enabled,
            voiceChannelId: data.voiceChannelId ?? null,
            textChannelId: data.textChannelId ?? null,
            updatedBy: data.updatedBy ?? null,
        };
        return await this.prisma.voiceListen.upsert({
            where: { guildId },
            create: { guildId, ...record },
            update: record,
        });
    }

    public async addOptOut(guildId: string, userId: string): Promise<VoiceListenOptOut> {
        return await this.prisma.voiceListenOptOut.upsert({
            where: { guildId_userId: { guildId, userId } },
            create: { guildId, userId },
            update: {},
        });
    }

    public async removeOptOut(guildId: string, userId: string): Promise<boolean> {
        const result = await this.prisma.voiceListenOptOut.deleteMany({ where: { guildId, userId } });
        return result.count > 0;
    }

    public async optOuts(guildId: string): Promise<VoiceListenOptOut[]> {
        return await this.prisma.voiceListenOptOut.findMany({ where: { guildId } });
    }
}
