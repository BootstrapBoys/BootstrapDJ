import type Dispatcher from '../core/Dispatcher.js';
import type { Song } from '../core/Dispatcher.js';
import type { BootstrapClient } from '../core/index.js';

import { formatDuration } from './NodeStatus.js';

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
    const settings: Record<string, string> = await client.db
        .getGuildSettings(guildId)
        .catch(() => ({}));
    const number = (value: string | undefined, fallback: number): number => {
        // A blank stored value is "unset", not zero. Treating it as zero made
        // an empty maxqueue row silently unlimited.
        if (value === undefined || value.trim() === '') return fallback;
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

/**
 * One guild-aware queue cap for every enqueue path. `maxQueue` is the
 * effective setting (guild override or `MAX_QUEUE_SIZE`); `0` means unlimited.
 */
export function queueHasRoom(player: Dispatcher, limits: PlayLimits, pending: number = 0): boolean {
    if (limits.maxQueue <= 0) return true;
    const queued = player.queue.length + (player.current ? 1 : 0) + pending;
    return queued < limits.maxQueue;
}

/** Returns a user-facing rejection reason, or null when the track fits. */
export function checkTrack(
    player: Dispatcher,
    track: Song,
    requesterId: string,
    limits: PlayLimits,
    pending: readonly Song[] = []
): string | null {
    const lengthSeconds = track.info.isStream ? 0 : Math.round(track.info.length / 1000);
    if (limits.maxTrackLength > 0 && lengthSeconds > limits.maxTrackLength) {
        return `That track is longer than this server's ${formatDuration(limits.maxTrackLength * 1000)} limit.`;
    }
    if (limits.minTrackLength > 0 && lengthSeconds > 0 && lengthSeconds < limits.minTrackLength) {
        return `That track is shorter than this server's ${formatDuration(limits.minTrackLength * 1000)} minimum.`;
    }
    // `/playnext <playlist>` builds its batch before inserting it, so the
    // queue alone would let every track pass the queue/user caps.
    const queued = player.queue.length + (player.current ? 1 : 0) + pending.length;
    if (limits.maxQueue > 0 && queued >= limits.maxQueue) {
        return `The queue is full (${limits.maxQueue} tracks).`;
    }
    const requested = [...player.queue, ...pending].filter(
        item => item.info.requester?.id === requesterId
    );
    if (limits.maxUserQueue > 0 && requested.length >= limits.maxUserQueue) {
        return `You already have ${limits.maxUserQueue} tracks queued.`;
    }
    if (limits.maxUserTracks > 0 && requested.length >= limits.maxUserTracks) {
        return `You already have ${limits.maxUserTracks} tracks queued.`;
    }
    if (limits.maxUserTracksLength > 0) {
        const total = requested.reduce(
            (sum, item) => sum + (item.info.isStream ? 0 : item.info.length),
            0
        );
        if (
            total + (track.info.isStream ? 0 : track.info.length) >
            limits.maxUserTracksLength * 1000
        ) {
            return `You already have ${formatDuration(limits.maxUserTracksLength * 1000)} of music queued.`;
        }
    }
    return null;
}
