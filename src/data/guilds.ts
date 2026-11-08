import type { AutoplaySetting, Guild, GuildSetting, PrismaClient } from '../generated/prisma/client.js';
import config from '../config.js';

/** Guild rows, prefixes, per-guild settings, and autoplay overrides. */
export class GuildStore {
    private readonly guildCache = new Map<string, Guild>();
    private readonly settingsCache = new Map<string, { at: number; data: Record<string, string> }>();

    public constructor(private readonly prisma: PrismaClient) {}

    public async get(guildId: string): Promise<Guild | null> {
        const cached = this.guildCache.get(guildId);
        if (cached) return cached;
        const row = await this.prisma.guild.upsert({
            where: { guildId },
            update: {},
            create: { guildId, prefix: config.prefix },
        });
        this.guildCache.set(guildId, row);
        return row;
    }

    public async setPrefix(guildId: string, prefix: string): Promise<void> {
        await this.prisma.guild.upsert({
            where: { guildId },
            update: { prefix },
            create: { guildId, prefix },
        });
        this.guildCache.delete(guildId);
    }

    public async settings(guildId: string): Promise<Record<string, string>> {
        const cached = this.settingsCache.get(guildId);
        if (cached && Date.now() - cached.at < 5000) return cached.data;
        const rows = await this.prisma.guildSetting.findMany({ where: { guildId } });
        const data = Object.fromEntries(rows.map((row: GuildSetting) => [row.key, row.value]));
        this.settingsCache.set(guildId, { at: Date.now(), data });
        return data;
    }

    public clearSettingsCache(guildId: string): void {
        this.settingsCache.delete(guildId);
    }

    public async setting(guildId: string, key: string): Promise<string | null> {
        const data = await this.settings(guildId);
        return data[key] ?? null;
    }

    public async setSetting(guildId: string, key: string, value: string): Promise<GuildSetting> {
        const row = await this.prisma.guildSetting.upsert({
            where: { guildId_key: { guildId, key } },
            create: { guildId, key, value },
            update: { value },
        });
        this.settingsCache.delete(guildId);
        return row;
    }

    public async resetSettings(guildId: string): Promise<number> {
        const result = await this.prisma.guildSetting.deleteMany({ where: { guildId } });
        this.settingsCache.delete(guildId);
        return result.count;
    }

    public async autoplay(guildId: string): Promise<AutoplaySetting | null> {
        return await this.prisma.autoplaySetting.findUnique({ where: { guildId } });
    }

    public async setAutoplay(guildId: string, data: { source: string; seeds: string }): Promise<AutoplaySetting> {
        return await this.prisma.autoplaySetting.upsert({
            where: { guildId },
            update: data,
            create: { guildId, ...data },
        });
    }

    public async deleteAutoplay(guildId: string): Promise<void> {
        await this.prisma.autoplaySetting.deleteMany({ where: { guildId } });
    }
}
