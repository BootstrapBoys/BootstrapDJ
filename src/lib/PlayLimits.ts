import type Dispatcher from '../core/Dispatcher.js';
import type { Song } from '../core/Dispatcher.js';
import type { BootstrapClient } from '../core/index.js';

import { formatDuration } from './NodeStatus.js';
import { DEFAULT_LANGUAGE, translate } from './i18n.js';

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
    pending: readonly Song[] = [],
    language: string = DEFAULT_LANGUAGE
): string | null {
    const copy = (key: string, variables: Record<string, string | number> = {}): string =>
        translate(`longtail:limits.${key}`, language, variables);
    const lengthSeconds = track.info.isStream ? 0 : Math.round(track.info.length / 1000);
    if (limits.maxTrackLength > 0 && lengthSeconds > limits.maxTrackLength) {
        return copy('maxLength', {
            limit: formatDuration(limits.maxTrackLength * 1000),
        });
    }
    if (limits.minTrackLength > 0 && lengthSeconds > 0 && lengthSeconds < limits.minTrackLength) {
        return copy('minLength', {
            limit: formatDuration(limits.minTrackLength * 1000),
        });
    }
    // `/playnext <playlist>` builds its batch before inserting it, so the
    // queue alone would let every track pass the queue/user caps.
    const queued = player.queue.length + (player.current ? 1 : 0) + pending.length;
    if (limits.maxQueue > 0 && queued >= limits.maxQueue) {
        return copy('queueFull', { count: limits.maxQueue });
    }
    const requested = [...player.queue, ...pending].filter(
        item => item.info.requester?.id === requesterId
    );
    if (limits.maxUserQueue > 0 && requested.length >= limits.maxUserQueue) {
        return copy('userQueue', { count: limits.maxUserQueue });
    }
    if (limits.maxUserTracks > 0 && requested.length >= limits.maxUserTracks) {
        return copy('userTracks', { count: limits.maxUserTracks });
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
            return copy('userLength', {
                length: formatDuration(limits.maxUserTracksLength * 1000),
            });
        }
    }
    return null;
}
