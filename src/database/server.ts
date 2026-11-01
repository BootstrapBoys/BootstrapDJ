

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import config from '../config.js';
import {
    Botchannel,
    Dj,
    Guild,
    Playlist,
    PrismaClient,
    Role,
    Session,
    Setup,
    Song,
    Stay,
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

export default class ServerData {
    private prisma: PrismaClient;
    /** Guild rows are read for every message and every command; cache them and
     * invalidate on write (single-process bot, so no cross-process staleness). */
    private guildCache = new Map<string, Guild>();
    private setupCache = new Map<string, Setup | null>();

    constructor(prisma?: PrismaClient) {
        // Injectable so tests can pass a client wired to a throwaway SQLite
        // file instead of the tracked database file.
        this.prisma = prisma ?? createPrismaClient();
    }

    public async get(guildId: string): Promise<Guild | null> {
        const cached = this.guildCache.get(guildId);
        if (cached) return cached;
        let data = await this.prisma.guild.findUnique({
            where: {
                guildId,
            },
        });
        if (!data) {
            data = await this.prisma.guild.create({
                data: {
                    guildId,
                    prefix: config.prefix,
                },
            });
        }
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

    public async setVoiceOptOutMuted(
        guildId: string,
        userId: string,
        mutedByBot: boolean
    ): Promise<void> {
        await this.prisma.voiceListenOptOut.updateMany({
            where: { guildId, userId },
            data: { mutedByBot },
        });
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

    public async getBotChannel(guildId: string): Promise<Botchannel | null> {
        return await this.prisma.botchannel.findUnique({
            where: {
                guildId,
            },
        });
    }

    public async setBotChannel(guildId: string, textId: string): Promise<void> {
        await this.prisma.botchannel.upsert({
            where: {
                guildId,
            },
            update: {
                textId,
            },
            create: {
                guildId,
                textId,
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
        let playlist = await this.getPLaylist(userId, name);
        if (!playlist) {
            await this.createPlaylist(userId, name);
            playlist = await this.getPLaylist(userId, name);
        }
        if (!playlist) throw new Error(`Could not resolve playlist ${name} for ${userId}`);
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

    public async removeSong(userId: string, name: string, song: string): Promise<void> {
        const playlist = await this.getPLaylist(userId, name);
        if (playlist) {
            await this.prisma.song.delete({
                where: {
                    track_playlistId: {
                        track: song,
                        playlistId: playlist.id,
                    },
                },
            });
        }
    }

    public async getSong(userId: string, name: string): Promise<Song[]> {
        const playlist = await this.getPLaylist(userId, name);
        if (playlist) {
            const songs = await this.prisma.song.findMany({
                where: {
                    playlistId: playlist.id,
                },
            });
            return songs;
        }
        return [];
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

    public async clearPlaylists(userId: string): Promise<void> {
        await this.prisma.playlist.deleteMany({
            where: {
                userId,
            },
        });
    }

    public async clearAllPlaylists(): Promise<void> {
        await this.prisma.playlist.deleteMany();
    }

    public async clearAllSongs(): Promise<void> {
        await this.prisma.song.deleteMany();
    }
}






