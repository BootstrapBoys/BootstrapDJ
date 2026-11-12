import type { BootstrapClient } from '../core/index.js';
import {
    readAccess,
    remoteFilter,
    remoteGuildIds,
    remoteGuilds,
    remotePlayer,
    remotePlayerAction,
} from './cluster.js';
import { collectHealth } from './health.js';
import { collectMetrics } from './metrics.js';
import { audioTapTargetFor } from './audioTap.js';
import { applyDashboardListenerCount } from './cleanup.js';
import { clearDashboardListeners } from './listeners.js';
import {
    addPlaylistTracks,
    clearPlaylist,
    createPlaylist,
    deletePlaylist,
    getPlaylistTracks,
    listPlaylists,
    loadPlaylist,
    removePlaylistTrack,
    removePlaylistTrackAt,
    renamePlaylist,
} from './playlists.js';
import { effectiveSettings, saveSettings } from './state.js';
import { addDashboardSong } from './playback.js';
import type { DashboardHost, DashboardUserIdentity } from './host.js';

/** Embedded dashboard backend: calls the live bot in the same process. */
export function createLocalDashboardHost(client: BootstrapClient): DashboardHost {
    const user = async (userId: string): Promise<DashboardUserIdentity | null> => {
        const cached = client.users.cache.get(userId);
        const member = cached ?? (await client.users.fetch(userId).catch(() => null));
        if (!member) return null;
        return {
            name: member.username,
            avatar: member.displayAvatarURL(),
        };
    };

    return {
        config: { icons: client.config.icons },
        logger: {
            error: message => client.logger.error(message),
            warn: message => client.logger.warn(message),
            info: message => client.logger.info(message),
        },
        guilds: userId => remoteGuilds(client, userId),
        guildIds: () => remoteGuildIds(client),
        access: (userId, guildId) => readAccess(client, userId, guildId),
        player: guildId => remotePlayer(client, guildId),
        audioTap: async guildId => audioTapTargetFor(client, guildId),
        dashboardAudio: async (guildId, count) => {
            applyDashboardListenerCount(client, guildId, count);
        },
        resetDashboardAudio: async () => {
            clearDashboardListeners();
        },
        playerAction: (guildId, action, value) =>
            remotePlayerAction(client, guildId, action, value),
        play: (guildId, userId, query) => addDashboardSong(client, guildId, userId, query),
        filter: (guildId, id, enabled, value) => remoteFilter(client, guildId, id, enabled, value),
        settings: guildId => effectiveSettings(client, guildId),
        saveSettings: (guildId, values) => saveSettings(client, guildId, values),
        userStats: (guildId, userId) => client.db.getUserStats(guildId, userId),
        stats: (guildId, days) => client.db.getStats(guildId, days),
        clearStats: guildId => client.db.clearStats(guildId),
        health: async () => await collectHealth(client),
        metrics: async () => collectMetrics(client),
        user,
        playlists: userId => listPlaylists(client, userId),
        playlistTracks: (userId, name) => getPlaylistTracks(client, userId, name),
        createPlaylist: (userId, name) => createPlaylist(client, userId, name),
        renamePlaylist: (userId, name, newName) => renamePlaylist(client, userId, name, newName),
        deletePlaylist: (userId, name) => deletePlaylist(client, userId, name),
        addPlaylistTracks: (userId, name, query) => addPlaylistTracks(client, userId, name, query),
        removePlaylistTrack: (userId, name, key) => removePlaylistTrack(client, userId, name, key),
        removePlaylistTrackAt: (userId, name, index) =>
            removePlaylistTrackAt(client, userId, name, index),
        clearPlaylist: (userId, name) => clearPlaylist(client, userId, name),
        loadPlaylist: (guildId, userId, name, shuffle) =>
            loadPlaylist(client, guildId, userId, name, shuffle),
    };
}
