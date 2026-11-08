import type { PrismaClient, Setup, Stay } from '../generated/prisma/client.js';
import { StatsStore } from './stats.js';

/**
 * Setup-channel rows and 24/7 voice stays.
 *
 * The setup row is read on every music command that posts to the configured
 * channel, so the last lookup is cached; writes invalidate it.
 */
export class SetupStore extends StatsStore {
    private readonly setupCache = new Map<string, Setup | null>();

    public constructor(prisma: PrismaClient) {
        super(prisma);
    }

    public async set_247(guildId: string, textId: string, voiceId: string): Promise<void> {
        await this.prisma.stay.upsert({
            where: { guildId },
            create: { guildId, textId, voiceId },
            update: { textId, voiceId },
        });
    }

    public async delete_247(guildId: string): Promise<void> {
        await this.prisma.stay.delete({ where: { guildId } });
    }

    public async get_247(guildId?: string): Promise<Stay | Stay[] | null> {
        if (!guildId) return await this.prisma.stay.findMany();
        return await this.prisma.stay.findUnique({ where: { guildId } });
    }

    public async getSetup(guildId: string): Promise<Setup | null> {
        if (this.setupCache.has(guildId)) return this.setupCache.get(guildId) ?? null;
        const setup = await this.prisma.setup.findUnique({ where: { guildId } });
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
            where: { guildId },
            create: { guildId, textId, messageId },
            update: { textId, messageId },
        });
        this.setupCache.delete(guildId);
    }

    public async deleteSetup(guildId: string): Promise<void> {
        await this.prisma.setup.delete({ where: { guildId } });
        this.setupCache.set(guildId, null);
    }
}
