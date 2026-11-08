import type {
    AutoplaySetting,
    Guild,
    GuildSetting,
    PrismaClient,
} from '../generated/prisma/client.js';
import config from '../config.js';

/** Short TTLs: another bot process may write the same SQLite file. */
const GUILD_CACHE_TTL_MS = 30_000;
const SETTINGS_CACHE_TTL_MS = 5_000;

/** Guild rows, prefixes, per-guild settings, and autoplay overrides. */
export class GuildStore {
    private readonly guildCache = new Map<string, { at: number; row: Guild }>();
    private readonly settingsCache = new Map<
        string,
        { at: number; data: Record<string, string> }
    >();

    public constructor(private readonly prisma: PrismaClient) {}

    public async get(guildId: string): Promise<Guild | null> {
        const cached = this.guildCache.get(guildId);
        if (cached && Date.now() - cached.at < GUILD_CACHE_TTL_MS) return { ...cached.row };
        if (cached) this.guildCache.delete(guildId);
        const row = await this.prisma.guild.upsert({
            where: { guildId },
            update: {},
            create: { guildId, prefix: config.prefix },
        });
        this.guildCache.set(guildId, { at: Date.now(), row });
        return { ...row };
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
        if (cached && Date.now() - cached.at < SETTINGS_CACHE_TTL_MS) return { ...cached.data };
        const rows = await this.prisma.guildSetting.findMany({ where: { guildId } });
        const data = Object.fromEntries(rows.map((row: GuildSetting) => [row.key, row.value]));
        this.settingsCache.set(guildId, { at: Date.now(), data });
        return { ...data };
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

    /**
     * Persist a validated batch in one transaction. A multi-key dashboard save
     * must not leave half of the form applied; the autoplay row is written once
     * so choosing a source and editing seeds cannot overwrite each other.
     */
    public async applySettings(
        guildId: string,
        entries: Record<string, string>,
        autoplay: { source: string; seeds: string } | 'delete' | null = null
    ): Promise<void> {
        const keys = Object.keys(entries);
        if (keys.length === 0 && !autoplay) return;

        await this.prisma.$transaction(async transaction => {
            for (const key of keys) {
                await transaction.guildSetting.upsert({
                    where: { guildId_key: { guildId, key } },
                    create: { guildId, key, value: entries[key] },
                    update: { value: entries[key] },
                });
            }
            if (autoplay === 'delete') {
                await transaction.autoplaySetting.deleteMany({ where: { guildId } });
            } else if (autoplay) {
                await transaction.autoplaySetting.upsert({
                    where: { guildId },
                    create: { guildId, ...autoplay },
                    update: autoplay,
                });
            }
        });
        this.settingsCache.delete(guildId);
    }

    public async resetSettings(guildId: string): Promise<number> {
        const result = await this.prisma.guildSetting.deleteMany({ where: { guildId } });
        this.settingsCache.delete(guildId);
        return result.count;
    }

    public async autoplay(guildId: string): Promise<AutoplaySetting | null> {
        return await this.prisma.autoplaySetting.findUnique({ where: { guildId } });
    }

    public async setAutoplay(
        guildId: string,
        data: { source: string; seeds: string }
    ): Promise<AutoplaySetting> {
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
