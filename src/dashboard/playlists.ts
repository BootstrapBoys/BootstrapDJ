import type { Track } from 'shoukaku';
import { LoadType } from 'shoukaku';

import type { BootstrapClient, Song } from '../core/index.js';
import { trackKey } from '../core/player/TrackIdentity.js';
import { getPlayLimits, queueHasRoom } from '../lib/PlayLimits.js';
import { ensureDashboardPlayer } from './playback.js';
import type {
    PlaylistAddResult,
    PlaylistLoadResult,
    PlaylistMutationResult,
    PlaylistSummary,
    PlaylistTrack,
} from './host.js';

const NAME_LIMIT = 50;
const IMPORT_LIMIT = 20;

type StoredRow = Awaited<ReturnType<BootstrapClient['db']['getSong']>>[number];

function normalizeName(value: string): string {
    return value.trim();
}

function nameError(name: string): PlaylistMutationResult | null {
    if (!name) return { ok: false, status: 400, error: 'Playlist name is required.' };
    if (name.length > NAME_LIMIT) {
        return {
            ok: false,
            status: 400,
            error: `Playlist names can be at most ${NAME_LIMIT} characters.`,
        };
    }
    return null;
}

function storedTracks(row: StoredRow): unknown[] | null {
    try {
        const parsed: unknown = JSON.parse(row.track);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return null;
    }
}

function isTrack(value: unknown): value is Track {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    if (typeof record.encoded !== 'string') return false;
    if (typeof record.info !== 'object' || record.info === null) return false;
    return true;
}

function firstTrack(row: StoredRow): Track | null {
    const entries = storedTracks(row);
    if (!entries) return null;
    return entries.find(isTrack) ?? null;
}

function keyOf(row: StoredRow, track: Track): string {
    return row.trackKey ?? trackKey(track);
}

function trackView(row: StoredRow): PlaylistTrack {
    const track = firstTrack(row);
    const info = track?.info;
    return {
        key: info && track ? keyOf(row, track) : (row.trackKey ?? row.id),
        title: info?.title ?? 'Unknown track',
        author: info?.author ?? '',
        duration: info?.length ?? 0,
        uri: info?.uri ?? null,
        source: info?.sourceName ?? '',
    };
}

export async function listPlaylists(
    client: BootstrapClient,
    userId: string
): Promise<PlaylistSummary[]> {
    const rows = await client.db.getPlaylists(userId);
    return rows.map(row => ({ name: row.name, trackCount: row._count.songs }));
}

export async function getPlaylistTracks(
    client: BootstrapClient,
    userId: string,
    name: string
): Promise<PlaylistTrack[]> {
    const rows = await client.db.getSong(userId, name);
    return rows.map(trackView);
}

export async function createPlaylist(
    client: BootstrapClient,
    userId: string,
    rawName: string
): Promise<PlaylistMutationResult> {
    const name = normalizeName(rawName);
    const invalid = nameError(name);
    if (invalid) return invalid;
    if (await client.db.getPLaylist(userId, name)) {
        return { ok: false, status: 409, error: 'A playlist with that name already exists.' };
    }
    try {
        await client.db.createPlaylist(userId, name);
        return { ok: true };
    } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
            return { ok: false, status: 409, error: 'A playlist with that name already exists.' };
        }
        throw error;
    }
}

export async function renamePlaylist(
    client: BootstrapClient,
    userId: string,
    rawName: string,
    rawNewName: string
): Promise<PlaylistMutationResult> {
    const name = normalizeName(rawName);
    const newName = normalizeName(rawNewName);
    const invalid = nameError(name) ?? nameError(newName);
    if (invalid) return invalid;
    if (!(await client.db.getPLaylist(userId, name))) {
        return { ok: false, status: 404, error: 'That playlist does not exist.' };
    }
    if (name === newName) return { ok: true };
    if (await client.db.getPLaylist(userId, newName)) {
        return { ok: false, status: 409, error: 'A playlist with that name already exists.' };
    }
    const renamed = await client.db.renamePlaylist(userId, name, newName);
    return renamed
        ? { ok: true }
        : { ok: false, status: 404, error: 'That playlist does not exist.' };
}

export async function deletePlaylist(
    client: BootstrapClient,
    userId: string,
    rawName: string
): Promise<PlaylistMutationResult> {
    const name = normalizeName(rawName);
    if (!name) return { ok: false, status: 400, error: 'Playlist name is required.' };
    const removed = await client.db.deletePlaylist(userId, name);
    return removed
        ? { ok: true }
        : { ok: false, status: 404, error: 'That playlist does not exist.' };
}

export async function addPlaylistTracks(
    client: BootstrapClient,
    userId: string,
    rawName: string,
    rawQuery: string
): Promise<PlaylistAddResult> {
    const name = normalizeName(rawName);
    const query = rawQuery.trim();
    const invalid = nameError(name);
    if (invalid) return invalid;
    if (!query) return { ok: false, status: 400, error: 'A track or search query is required.' };
    if (!(await client.db.getPLaylist(userId, name))) {
        return { ok: false, status: 404, error: 'That playlist does not exist.' };
    }

    let result;
    try {
        result = await client.queue.search(query, client.config.searchEngine);
    } catch {
        return { ok: false, status: 503, error: 'Lavalink is not available right now.' };
    }
    if (!result) return { ok: false, status: 404, error: 'No results found.' };

    let tracks: Track[] = [];
    if (result.loadType === LoadType.PLAYLIST) tracks = result.data.tracks;
    else if (result.loadType === LoadType.TRACK) tracks = [result.data];
    else if (result.loadType === LoadType.SEARCH) tracks = result.data.slice(0, IMPORT_LIMIT);
    if (!tracks.length) return { ok: false, status: 404, error: 'No tracks found.' };

    let added = 0;
    for (const track of tracks) {
        if (await client.db.addSong(userId, name, track)) added += 1;
    }
    return { ok: true, added, skipped: tracks.length - added };
}

export async function removePlaylistTrack(
    client: BootstrapClient,
    userId: string,
    rawName: string,
    key: string
): Promise<PlaylistMutationResult> {
    const name = normalizeName(rawName);
    if (!name) return { ok: false, status: 400, error: 'Playlist name is required.' };
    if (!key) return { ok: false, status: 400, error: 'Track key is required.' };
    const removed = await client.db.removeSong(userId, name, key);
    return removed
        ? { ok: true }
        : { ok: false, status: 404, error: 'That track is not in the playlist.' };
}

export async function removePlaylistTrackAt(
    client: BootstrapClient,
    userId: string,
    rawName: string,
    index: number
): Promise<PlaylistMutationResult> {
    const name = normalizeName(rawName);
    if (!name) return { ok: false, status: 400, error: 'Playlist name is required.' };
    if (!Number.isInteger(index) || index < 1) {
        return { ok: false, status: 400, error: 'Track position must be a positive number.' };
    }
    const removed = await client.db.removeSongAt(userId, name, index);
    return removed ? { ok: true } : { ok: false, status: 404, error: 'No track at that position.' };
}

export async function clearPlaylist(
    client: BootstrapClient,
    userId: string,
    rawName: string
): Promise<PlaylistMutationResult> {
    const name = normalizeName(rawName);
    if (!name) return { ok: false, status: 400, error: 'Playlist name is required.' };
    if (!(await client.db.getPLaylist(userId, name))) {
        return { ok: false, status: 404, error: 'That playlist does not exist.' };
    }
    await client.db.clearPlaylist(userId, name);
    return { ok: true };
}

export async function loadPlaylist(
    client: BootstrapClient,
    guildId: string,
    userId: string,
    rawName: string
): Promise<PlaylistLoadResult> {
    const name = normalizeName(rawName);
    if (!name) return { ok: false, status: 400, error: 'Playlist name is required.' };
    const rows = await client.db.getSong(userId, name);
    if (!rows.length) {
        return { ok: false, status: 404, error: 'That playlist is empty or does not exist.' };
    }
    const ensured = await ensureDashboardPlayer(client, guildId);
    if (!ensured.ok) {
        return { ok: false, status: ensured.status, error: ensured.error };
    }
    const player = ensured.player;
    const requester = await client.users.fetch(userId).catch(() => client.user);
    if (!requester) {
        return { ok: false, status: 500, error: 'Could not resolve the playlist owner.' };
    }

    const limits = await getPlayLimits(client, guildId);
    const queued: Song[] = [];
    let skipped = 0;
    for (const row of rows) {
        const entries = storedTracks(row);
        if (!entries) {
            skipped += 1;
            continue;
        }
        for (const entry of entries) {
            if (!isTrack(entry) || !queueHasRoom(player, limits)) {
                skipped += 1;
                continue;
            }
            const song = player.buildTrack(entry, requester);
            player.enqueue(song, false, false);
            queued.push(song);
        }
    }

    player.seedPlaylist(queued);
    await player.isPlaying();
    return { ok: true, queued: queued.length, skipped };
}
