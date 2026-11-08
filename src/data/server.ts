import {
    AutoplaySetting,
    BotPresence,
    CollectionShare,
    Guild,
    GuildSetting,
    Playlist,
    PrismaClient,
    Profile,
    RecentTrack,
    Session,
    SessionLease,
    Song,
    UserPrefix,
    VoiceListen,
    VoiceListenOptOut,
} from '../generated/prisma/client.js';
import { GuildStore } from './guilds.js';
import { PermissionStore } from './permissions.js';
import { PlaylistStore } from './playlists.js';
import { createPrismaClient, initializePrisma } from './prisma.js';
import { SessionStore } from './sessions.js';
import { UserStore } from './users.js';
import { VoiceStore } from './voice.js';

export type { StatsPruneResult } from './stats.js';

/**
 * Composition root for persistence.
 *
 * Each table group has its own store; this class wires them together and keeps
 * the `db.*` call surface that commands, events, plugins, and the dashboard
 * already use. The permission/setup/statistics stores come in through the base
 * class chain, the rest are composed here. New code may use the public store
 * fields directly — this facade should not grow new behaviour of its own.
 */
export default class ServerData extends PermissionStore {
    public readonly playlists: PlaylistStore;
    public readonly guilds: GuildStore;
    public readonly sessions: SessionStore;
    public readonly users: UserStore;
    public readonly voice: VoiceStore;
    /** PRAGMAs are connection/file scoped; every bot process runs this once. */
    private initPromise: Promise<void> | null = null;
    /**
     * Per-guild session writes. Persist, stop and destroy each fire a write
     * without awaiting it, so a snapshot taken before `/stop` could land after
     * the delete and resurrect the row. Chaining writes per guild makes the
     * last call win: an earlier save always settles before a later delete.
     */
    private readonly sessionWrites = new Map<string, Promise<void>>();

    public constructor(prisma?: PrismaClient) {
        super(prisma ?? createPrismaClient());
        this.playlists = new PlaylistStore(this.prisma);
        this.guilds = new GuildStore(this.prisma);
        this.sessions = new SessionStore(this.prisma);
        this.users = new UserStore(this.prisma);
        this.voice = new VoiceStore(this.prisma);
    }

    /**
     * Enable SQLite's concurrent-reader mode. WAL lives in the database file, so
     * setting it once is enough; busy_timeout and synchronous are per-connection
     * and every bot process has to set them.
     */
    public async initialize(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = initializePrisma(this.prisma).catch(error => {
                this.initPromise = null;
                throw error;
            });
        }
        await this.initPromise;
    }

    // ---- guild rows -------------------------------------------------------

    public async get(guildId: string): Promise<Guild | null> {
        return await this.guilds.get(guildId);
    }

    public async setPrefix(guildId: string, prefix: string): Promise<void> {
        await this.guilds.setPrefix(guildId, prefix);
    }

    /** DJ mode is the only permission-layer write the facade performs itself. */
    public async setDj(guildId: string, mode: boolean): Promise<void> {
        await this.prisma.dj.upsert({
            where: { guildId },
            create: { guildId, mode },
            update: { mode },
        });
    }

    // ---- presence and playback leases ------------------------------------

    public async heartbeatBot(botId: string, name: string): Promise<BotPresence> {
        return await this.sessions.heartbeat(botId, name);
    }

    public async getBotPresence(botId: string): Promise<BotPresence | null> {
        return await this.sessions.presence(botId);
    }

    public async claimSessionLease(
        guildId: string,
        botId: string,
        botName: string,
        ttlMs: number = 60_000
    ): Promise<boolean> {
        return await this.sessions.claim(guildId, botId, botName, ttlMs);
    }

    public async getSessionLease(guildId: string): Promise<SessionLease | null> {
        return await this.sessions.lease(guildId);
    }

    public async releaseSessionLease(guildId: string, botId: string): Promise<void> {
        await this.sessions.release(guildId, botId);
    }

    public async recordRecentTrack(
        guildId: string,
        payload: string,
        title: string,
        author: string,
        uri: string | null,
        requesterId: string | null
    ): Promise<void> {
        await this.sessions.recordRecent(guildId, payload, title, author, uri, requesterId);
    }

    public async getRecentTracks(guildId: string, limit: number): Promise<RecentTrack[]> {
        return await this.sessions.recent(guildId, limit);
    }

    // ---- per-user rows ----------------------------------------------------

    public async getUserPrefix(guildId: string, userId: string): Promise<string | null> {
        return await this.users.prefix(guildId, userId);
    }

    public async setUserPrefix(
        guildId: string,
        userId: string,
        prefix: string
    ): Promise<UserPrefix> {
        return await this.users.setPrefix(guildId, userId, prefix);
    }

    public async resetUserPrefix(guildId: string, userId: string): Promise<boolean> {
        return await this.users.resetPrefix(guildId, userId);
    }

    public async getProfile(userId: string): Promise<Profile | null> {
        return await this.users.profile(userId);
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
        return await this.users.saveProfile(userId, data);
    }

    // ---- guild settings and autoplay -------------------------------------

    public async getGuildSettings(guildId: string): Promise<Record<string, string>> {
        return await this.guilds.settings(guildId);
    }

    public clearGuildSettingsCache(guildId: string): void {
        this.guilds.clearSettingsCache(guildId);
    }

    public async getGuildSetting(guildId: string, key: string): Promise<string | null> {
        return await this.guilds.setting(guildId, key);
    }

    public async setGuildSetting(
        guildId: string,
        key: string,
        value: string
    ): Promise<GuildSetting> {
        return await this.guilds.setSetting(guildId, key, value);
    }

    /** Atomic multi-key settings write; the dashboard validates before calling. */
    public async applySettings(
        guildId: string,
        entries: Record<string, string>,
        autoplay: { source: string; seeds: string } | 'delete' | null = null
    ): Promise<void> {
        await this.guilds.applySettings(guildId, entries, autoplay);
    }

    public async resetGuildSettings(guildId: string): Promise<number> {
        return await this.guilds.resetSettings(guildId);
    }

    public async getAutoplaySetting(guildId: string): Promise<AutoplaySetting | null> {
        return await this.guilds.autoplay(guildId);
    }

    public async setAutoplaySetting(
        guildId: string,
        data: { source: string; seeds: string }
    ): Promise<AutoplaySetting> {
        return await this.guilds.setAutoplay(guildId, data);
    }

    public async deleteAutoplaySetting(guildId: string): Promise<void> {
        await this.guilds.deleteAutoplay(guildId);
    }

    // ---- voice listener ---------------------------------------------------

    public async getVoiceListen(guildId: string): Promise<VoiceListen | null> {
        return await this.voice.get(guildId);
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
        return await this.voice.set(guildId, data);
    }

    public async addVoiceOptOut(guildId: string, userId: string): Promise<VoiceListenOptOut> {
        return await this.voice.addOptOut(guildId, userId);
    }

    public async removeVoiceOptOut(guildId: string, userId: string): Promise<boolean> {
        return await this.voice.removeOptOut(guildId, userId);
    }

    public async listVoiceOptOuts(guildId: string): Promise<VoiceListenOptOut[]> {
        return await this.voice.optOuts(guildId);
    }

    // ---- saved playback sessions -----------------------------------------

    /** Serialize one guild's session writes so call order is write order. */
    private enqueueSessionWrite(guildId: string, task: () => Promise<void>): Promise<void> {
        const previous = this.sessionWrites.get(guildId) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(task);
        this.sessionWrites.set(guildId, next);
        const release = (): void => {
            if (this.sessionWrites.get(guildId) === next) this.sessionWrites.delete(guildId);
        };
        void next.then(release, release);
        return next;
    }

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
        await this.enqueueSessionWrite(session.guildId, async () => {
            await this.sessions.save(session);
        });
    }

    public async getSessions(): Promise<Session[]> {
        return await this.sessions.all();
    }

    public async getSessionGuildIds(): Promise<string[]> {
        return await this.sessions.guildIds();
    }

    public async getSession(guildId: string): Promise<Session | null> {
        return await this.sessions.get(guildId);
    }

    public async deleteSession(guildId: string): Promise<void> {
        await this.enqueueSessionWrite(guildId, async () => {
            await this.sessions.remove(guildId);
        });
    }

    // ---- playlists, songs, shares ----------------------------------------

    /** Legacy spelling: kept because existing call sites use it verbatim. */
    public async getPLaylist(userId: string, name: string): Promise<Playlist | null> {
        return await this.playlists.get(userId, name);
    }

    public async getPlaylists(
        userId: string
    ): Promise<(Playlist & { _count: { songs: number } })[]> {
        return await this.playlists.list(userId);
    }

    public async createPlaylist(userId: string, name: string): Promise<void> {
        await this.playlists.create(userId, name);
    }

    public async deletePlaylist(userId: string, name: string): Promise<boolean> {
        return await this.playlists.remove(userId, name);
    }

    public async addSong(userId: string, name: string, track: unknown): Promise<boolean> {
        return await this.playlists.addSong(userId, name, track);
    }

    public async removeSong(userId: string, name: string, songKey: string): Promise<boolean> {
        return await this.playlists.removeSong(userId, name, songKey);
    }

    public async getSong(userId: string, name: string): Promise<Song[]> {
        return await this.playlists.songs(userId, name);
    }

    public async createCollectionShare(
        ownerId: string,
        name: string,
        code: string
    ): Promise<CollectionShare> {
        return await this.playlists.createShare(ownerId, name, code);
    }

    public async getCollectionShare(code: string): Promise<CollectionShare | null> {
        return await this.playlists.getShare(code);
    }

    public async deleteCollectionShare(ownerId: string, code: string): Promise<boolean> {
        return await this.playlists.deleteShare(ownerId, code);
    }

    public async listCollectionShares(ownerId: string): Promise<CollectionShare[]> {
        return await this.playlists.listShares(ownerId);
    }

    public async removeSongAt(userId: string, name: string, index: number): Promise<boolean> {
        return await this.playlists.removeAt(userId, name, index);
    }

    public async clearPlaylist(userId: string, name: string): Promise<void> {
        await this.playlists.clear(userId, name);
    }
}
