import type {
    AccessResult,
    ActionError,
    DashboardGuild,
    FilterResult,
    PlayerSnapshot,
} from './shardApi.js';
import type { AudioTapTarget } from './audioTap.js';

export type DashboardUserIdentity = {
    name: string;
    avatar: string | null;
};

export type PlaylistSummary = {
    name: string;
    trackCount: number;
};

export type PlaylistTrack = {
    key: string;
    title: string;
    author: string;
    duration: number;
    uri: string | null;
    source: string;
};

export type PlaylistMutationResult = {
    ok: boolean;
    error?: string;
    status?: number;
};

export type PlaylistAddResult = PlaylistMutationResult & {
    added?: number;
    skipped?: number;
};

export type PlaylistLoadResult = PlaylistMutationResult & {
    queued?: number;
    skipped?: number;
};

export type QueueAddResult = PlaylistMutationResult & {
    added?: number;
    skipped?: number;
    title?: string;
};

/**
 * Everything the dashboard routes need from the bot.
 *
 * `embedded` mode implements this over the live BootstrapClient. `sidecar`
 * mode implements the same contract over an authenticated loopback control
 * API, so the HTTP process can be restarted without touching voice/Discord.
 */
export interface DashboardHost {
    readonly config: { icons: Record<string, string> };
    readonly logger: {
        error(message: string): void;
        warn(message: string): void;
        info(message: string): void;
    };
    guilds(userId: string | null): Promise<DashboardGuild[]>;
    guildIds(): Promise<string[]>;
    access(userId: string | null, guildId: string): Promise<AccessResult>;
    player(guildId: string): Promise<{ found: boolean; player: PlayerSnapshot | null }>;
    audioTap(guildId: string): Promise<AudioTapTarget | null>;
    playerAction(guildId: string, action: string, value: number): Promise<ActionError>;
    play(guildId: string, userId: string, query: string): Promise<QueueAddResult>;
    filter(guildId: string, id: string, enabled: boolean, value?: number): Promise<FilterResult>;
    settings(guildId: string): Promise<Record<string, string>>;
    saveSettings(guildId: string, values: Record<string, string>): Promise<void>;
    userStats(guildId: string, userId: string): Promise<unknown>;
    stats(guildId: string, days: number): Promise<Record<string, unknown>>;
    clearStats(guildId: string): Promise<number>;
    metrics(): Promise<Record<string, unknown>>;
    user(userId: string): Promise<DashboardUserIdentity | null>;
    playlists(userId: string): Promise<PlaylistSummary[]>;
    playlistTracks(userId: string, name: string): Promise<PlaylistTrack[]>;
    createPlaylist(userId: string, name: string): Promise<PlaylistMutationResult>;
    renamePlaylist(userId: string, name: string, newName: string): Promise<PlaylistMutationResult>;
    deletePlaylist(userId: string, name: string): Promise<PlaylistMutationResult>;
    addPlaylistTracks(userId: string, name: string, query: string): Promise<PlaylistAddResult>;
    removePlaylistTrack(userId: string, name: string, key: string): Promise<PlaylistMutationResult>;
    removePlaylistTrackAt(
        userId: string,
        name: string,
        index: number
    ): Promise<PlaylistMutationResult>;
    clearPlaylist(userId: string, name: string): Promise<PlaylistMutationResult>;
    loadPlaylist(guildId: string, userId: string, name: string): Promise<PlaylistLoadResult>;
}

/** Error returned by the dashboard sidecar's loopback control client. */
export class DashboardRemoteError extends Error {
    public readonly status: number;

    public constructor(message: string, status: number = 502) {
        super(message);
        this.name = 'DashboardRemoteError';
        this.status = status;
    }
}
