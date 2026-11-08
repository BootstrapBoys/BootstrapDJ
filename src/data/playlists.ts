import type { CollectionShare, Playlist, PrismaClient, Song } from '../generated/prisma/client.js';
import { trackKey } from './prisma.js';

/** Playlist, song-row, and collection-share persistence. */
export class PlaylistStore {
    public constructor(private readonly prisma: PrismaClient) {}

    public async get(userId: string, name: string): Promise<Playlist | null> {
        return await this.prisma.playlist.findUnique({ where: { userId_name: { userId, name } } });
    }

    public async list(userId: string): Promise<(Playlist & { _count: { songs: number } })[]> {
        return await this.prisma.playlist.findMany({
            where: { userId },
            orderBy: { name: 'asc' },
            include: { _count: { select: { songs: true } } },
        });
    }

    public async create(userId: string, name: string): Promise<void> {
        await this.prisma.playlist.create({ data: { userId, name } });
    }

    public async remove(userId: string, name: string): Promise<boolean> {
        const playlist = await this.get(userId, name);
        if (!playlist) return false;
        await this.prisma.$transaction([
            this.prisma.song.deleteMany({ where: { playlistId: playlist.id } }),
            this.prisma.playlist.delete({ where: { id: playlist.id } }),
        ]);
        return true;
    }

    private async legacyDuplicate(
        playlistId: string,
        key: string
    ): Promise<Pick<Song, 'id' | 'track'> | undefined> {
        const rows = await this.prisma.song.findMany({
            where: { playlistId, trackKey: null },
            select: { id: true, track: true },
        });
        return rows.find(row => {
            try {
                const parsed: unknown = JSON.parse(row.track);
                const entries = Array.isArray(parsed) ? parsed : [parsed];
                return entries.some(entry => trackKey(entry) === key);
            } catch {
                return false;
            }
        });
    }

    public async addSong(userId: string, name: string, track: unknown): Promise<boolean> {
        const playlist = await this.prisma.playlist.upsert({
            where: { userId_name: { userId, name } },
            create: { userId, name },
            update: {},
        });
        const key = trackKey(track);
        if (key) {
            const existing = await this.prisma.song.findFirst({
                where: { playlistId: playlist.id, trackKey: key },
                select: { id: true },
            });
            if (existing) return false;
            const legacy = await this.legacyDuplicate(playlist.id, key);
            if (legacy) {
                await this.prisma.song.update({
                    where: { id: legacy.id },
                    data: { trackKey: key },
                });
                return false;
            }
        }
        try {
            await this.prisma.$transaction(async tx => {
                const last = await tx.song.findFirst({
                    where: { playlistId: playlist.id },
                    orderBy: { position: 'desc' },
                    select: { position: true },
                });
                await tx.song.create({
                    data: {
                        track: JSON.stringify(track),
                        playlistId: playlist.id,
                        trackKey: key,
                        position: (last?.position ?? -1) + 1,
                    },
                });
            });
        } catch (error) {
            if ((error as { code?: string }).code === 'P2002') return false;
            throw error;
        }
        return true;
    }

    public async removeSong(userId: string, name: string, key: string): Promise<boolean> {
        const playlist = await this.get(userId, name);
        if (!playlist) return false;
        const direct = await this.prisma.song.findFirst({
            where: { playlistId: playlist.id, trackKey: key },
            select: { id: true },
        });
        if (direct) {
            await this.prisma.song.delete({ where: { id: direct.id } });
            return true;
        }
        const row = await this.legacyDuplicate(playlist.id, key);
        if (!row) return false;
        await this.prisma.song.delete({ where: { id: row.id } });
        return true;
    }

    public async songs(userId: string, name: string): Promise<Song[]> {
        const playlist = await this.get(userId, name);
        if (!playlist) return [];
        return await this.prisma.song.findMany({
            where: { playlistId: playlist.id },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
        });
    }

    public async createShare(
        ownerId: string,
        name: string,
        code: string
    ): Promise<CollectionShare> {
        return await this.prisma.collectionShare.create({ data: { code, ownerId, name } });
    }

    public async getShare(code: string): Promise<CollectionShare | null> {
        return await this.prisma.collectionShare.findUnique({ where: { code } });
    }

    public async deleteShare(ownerId: string, code: string): Promise<boolean> {
        const result = await this.prisma.collectionShare.deleteMany({ where: { code, ownerId } });
        return result.count > 0;
    }

    public async listShares(ownerId: string): Promise<CollectionShare[]> {
        return await this.prisma.collectionShare.findMany({
            where: { ownerId },
            orderBy: { createdAt: 'desc' },
        });
    }

    public async removeAt(userId: string, name: string, index: number): Promise<boolean> {
        const rows = await this.songs(userId, name);
        const row = rows[index - 1];
        if (!row) return false;
        await this.prisma.song.delete({ where: { id: row.id } });
        return true;
    }

    public async clear(userId: string, name: string): Promise<void> {
        const playlist = await this.get(userId, name);
        if (!playlist) return;
        await this.prisma.song.deleteMany({ where: { playlistId: playlist.id } });
    }
}
