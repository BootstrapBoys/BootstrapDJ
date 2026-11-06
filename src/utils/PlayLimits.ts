import type Dispatcher from '../structures/Dispatcher.js';
import type { Song } from '../structures/Dispatcher.js';
import type { BootstrapClient } from '../structures/index.js';

export type PlayLimits = {
    maxTrackLength: number;
    minTrackLength: number;
    maxQueue: number;
    maxUserTracks: number;
    maxUserTracksLength: number;
    maxUserQueue: number;
    maxPlaylistTracks: number;
    maxPlaylistLength: number;
};

/** Read per-guild playback limits once per command invocation. */
export async function getPlayLimits(client: BootstrapClient, guildId: string): Promise<PlayLimits> {
    const settings: Record<string, string> = await client.db.getGuildSettings(guildId).catch(() => ({}));
    const number = (value: string | undefined, fallback: number): number => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    return {
        maxTrackLength: number(settings.maxtracklength, 0),
        minTrackLength: number(settings.mintracklength, 0),
        maxQueue: number(settings.maxqueue, client.config.maxQueueSize),
        maxUserTracks: number(settings.maxusertracks, 0),
        maxUserTracksLength: number(settings.maxusertrackslength, 0),
        maxUserQueue: number(settings.maxuserqueue, 50),
        maxPlaylistTracks: number(settings.maxplaylisttracks, 0),
        maxPlaylistLength: number(settings.maxplaylistlength, 0),
    };
}

/** Returns a user-facing rejection reason, or null when the track fits. */
export function checkTrack(
    player: Dispatcher,
    track: Song,
    requesterId: string,
    limits: PlayLimits
): string | null {
    const lengthSeconds = track.info.isStream ? 0 : Math.round(track.info.length / 1000);
    if (limits.maxTrackLength > 0 && lengthSeconds > limits.maxTrackLength) {
        return `That track is longer than this server's ${limits.maxTrackLength}s limit.`;
    }
    if (limits.minTrackLength > 0 && lengthSeconds > 0 && lengthSeconds < limits.minTrackLength) {
        return `That track is shorter than this server's ${limits.minTrackLength}s minimum.`;
    }
    const queued = player.queue.length + (player.current ? 1 : 0);
    if (limits.maxQueue > 0 && queued >= limits.maxQueue) {
        return `The queue is full (${limits.maxQueue} tracks).`;
    }
    const requested = player.queue.filter(item => item.info.requester?.id === requesterId);
    if (limits.maxUserQueue > 0 && requested.length >= limits.maxUserQueue) {
        return `You already have ${limits.maxUserQueue} tracks queued.`;
    }
    if (limits.maxUserTracks > 0 && requested.length >= limits.maxUserTracks) {
        return `You already have ${limits.maxUserTracks} tracks queued.`;
    }
    if (limits.maxUserTracksLength > 0) {
        const total = requested.reduce((sum, item) => sum + (item.info.isStream ? 0 : item.info.length), 0);
        if (total + (track.info.isStream ? 0 : track.info.length) > limits.maxUserTracksLength * 1000) {
            return `You already have ${limits.maxUserTracksLength}s of music queued.`;
        }
    }
    return null;
}
