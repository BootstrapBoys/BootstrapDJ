import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import config from '../config.js';
import type { BootstrapClient } from '../core/index.js';
import {
    readAccess,
    remoteFilter,
    remoteGuildIds,
    remoteGuilds,
    remotePlayer,
    remotePlayerAction,
} from './cluster.js';
import { collectMetrics } from './metrics.js';
import { addDashboardSong } from './playback.js';
import { audioTapTargetFor } from './audioTap.js';
import { applyDashboardListenerCount, scheduleDashboardCleanupFromSettings } from './cleanup.js';
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
import { effectiveSettings, saveSettings, SettingValidationError } from './state.js';

const MAX_BODY_BYTES = 64_000;
const CONTROL_HEADER = 'x-bootstrap-control';

function json(res: http.ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(payload));
}

function text(res: http.ServerResponse, status: number, payload: string): void {
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end(payload);
}

function authorized(req: http.IncomingMessage): boolean {
    const expected = config.dashboardControlSecret;
    const supplied = String(req.headers[CONTROL_HEADER] ?? '');
    if (!expected || supplied.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk: Buffer) => {
            raw += chunk.toString('utf8');
            if (raw.length > MAX_BODY_BYTES) {
                reject(new Error('Request too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!raw) {
                resolve({});
                return;
            }
            try {
                const parsed: unknown = JSON.parse(raw);
                if (!isRecord(parsed)) {
                    reject(new Error('Invalid JSON'));
                    return;
                }
                resolve(parsed);
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

async function handleControl(
    client: BootstrapClient,
    req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> {
    if (!authorized(req)) {
        text(res, 401, 'unauthorized');
        return;
    }

    const method = req.method ?? '';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (method === 'GET' && path === '/internal/guilds') {
        const userId = url.searchParams.get('userId');
        json(res, 200, await remoteGuilds(client, userId));
        return;
    }

    if (method === 'GET' && path === '/internal/guild-ids') {
        json(res, 200, await remoteGuildIds(client));
        return;
    }

    if (method === 'GET' && path === '/internal/access') {
        const guildId = url.searchParams.get('guildId') ?? '';
        const userId = url.searchParams.get('userId');
        json(res, 200, await readAccess(client, userId, guildId));
        return;
    }

    if (method === 'GET' && path === '/internal/player') {
        const guildId = url.searchParams.get('guildId') ?? '';
        json(res, 200, await remotePlayer(client, guildId));
        return;
    }

    if (method === 'GET' && path === '/internal/audio-target') {
        const guildId = url.searchParams.get('guildId') ?? '';
        const target = audioTapTargetFor(client, guildId);
        json(res, 200, {
            target: target ? { url: target.url.toString(), password: target.password } : null,
        });
        return;
    }

    if (method === 'POST' && path === '/internal/dashboard-audio') {
        const body = await readBody(req);
        const guildId = stringValue(body.guildId);
        const count = Number(body.count);
        if (!guildId) {
            json(res, 400, { ok: false, status: 400, error: 'guildId is required' });
            return;
        }
        json(res, 200, {
            ok: true,
            count: applyDashboardListenerCount(client, guildId, count),
        });
        return;
    }

    if (method === 'POST' && path === '/internal/dashboard-audio/reset') {
        clearDashboardListeners();
        for (const guildId of client.queue.keys()) {
            void scheduleDashboardCleanupFromSettings(client, guildId);
        }
        json(res, 200, { ok: true });
        return;
    }

    if (method === 'POST' && path === '/internal/player') {
        const body = await readBody(req);
        const guildId = stringValue(body.guildId);
        const result = await remotePlayerAction(
            client,
            guildId,
            stringValue(body.action),
            Number(body.value ?? 0)
        );
        json(res, 200, result);
        return;
    }

    if (method === 'POST' && path === '/internal/play') {
        const body = await readBody(req);
        const guildId = stringValue(body.guildId);
        const userId = stringValue(body.userId);
        if (!guildId || !userId) {
            json(res, 400, { ok: false, status: 400, error: 'guildId and userId are required' });
            return;
        }
        json(res, 200, await addDashboardSong(client, guildId, userId, stringValue(body.query)));
        return;
    }

    if (method === 'POST' && path === '/internal/filter') {
        const body = await readBody(req);
        const value = body.value === undefined ? undefined : Number(body.value);
        const result = await remoteFilter(
            client,
            stringValue(body.guildId),
            stringValue(body.filter),
            Boolean(body.enabled),
            value
        );
        json(res, 200, result);
        return;
    }

    if (method === 'GET' && path === '/internal/settings') {
        const guildId = url.searchParams.get('guildId') ?? '';
        json(res, 200, await effectiveSettings(client, guildId));
        return;
    }

    if (method === 'POST' && path === '/internal/settings') {
        const body = await readBody(req);
        const guildId = stringValue(body.guildId);
        const raw = isRecord(body.values) ? body.values : {};
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(raw)) values[key] = stringValue(value);
        try {
            await saveSettings(client, guildId, values);
            client.clearGuildSettingsCache(guildId);
            json(res, 200, { ok: true });
        } catch (error) {
            if (error instanceof SettingValidationError) {
                json(res, 400, { error: error.message });
                return;
            }
            throw error;
        }
        return;
    }

    if (method === 'GET' && path === '/internal/stats') {
        const guildId = url.searchParams.get('guildId') ?? '';
        const requested = Number(url.searchParams.get('days') ?? 7);
        const days = Number.isFinite(requested)
            ? Math.min(90, Math.max(1, Math.floor(requested)))
            : 7;
        json(res, 200, await client.db.getStats(guildId, days));
        return;
    }

    if (method === 'POST' && path === '/internal/stats/clear') {
        const body = await readBody(req);
        const guildId = stringValue(body.guildId);
        const removed = await client.db.clearStats(guildId);
        json(res, 200, { ok: true, removed });
        return;
    }

    if (method === 'GET' && path === '/internal/me/stats') {
        const guildId = url.searchParams.get('guildId') ?? '';
        const userId = url.searchParams.get('userId') ?? '';
        json(res, 200, await client.db.getUserStats(guildId, userId));
        return;
    }

    if (method === 'GET' && path === '/internal/metrics') {
        json(res, 200, collectMetrics(client));
        return;
    }

    if (method === 'GET' && path === '/internal/user') {
        const userId = url.searchParams.get('id') ?? '';
        const cached = client.users.cache.get(userId);
        const user = cached ?? (await client.users.fetch(userId).catch(() => null));
        json(res, 200, user ? { name: user.username, avatar: user.displayAvatarURL() } : null);
        return;
    }

    if (method === 'GET' && path === '/internal/playlists') {
        const userId = url.searchParams.get('userId') ?? '';
        if (!userId) {
            json(res, 400, { error: 'userId is required' });
            return;
        }
        json(res, 200, await listPlaylists(client, userId));
        return;
    }

    if (method === 'POST' && path === '/internal/playlists') {
        const body = await readBody(req);
        const userId = stringValue(body.userId);
        const name = stringValue(body.name);
        if (!userId) {
            json(res, 400, { error: 'userId is required' });
            return;
        }
        if (stringValue(body.action) === 'create') {
            json(res, 200, await createPlaylist(client, userId, name));
            return;
        }
        if (stringValue(body.action) === 'rename') {
            json(res, 200, await renamePlaylist(client, userId, name, stringValue(body.newName)));
            return;
        }
        if (stringValue(body.action) === 'delete') {
            json(res, 200, await deletePlaylist(client, userId, name));
            return;
        }
        json(res, 400, { ok: false, status: 400, error: 'Unknown playlist action' });
        return;
    }

    if (method === 'GET' && path === '/internal/playlists/tracks') {
        const userId = url.searchParams.get('userId') ?? '';
        const name = url.searchParams.get('name') ?? '';
        if (!userId) {
            json(res, 400, { error: 'userId is required' });
            return;
        }
        json(res, 200, await getPlaylistTracks(client, userId, name));
        return;
    }

    if (method === 'POST' && path === '/internal/playlists/tracks') {
        const body = await readBody(req);
        const userId = stringValue(body.userId);
        const name = stringValue(body.name);
        if (!userId) {
            json(res, 400, { ok: false, status: 400, error: 'userId is required' });
            return;
        }
        const action = stringValue(body.action);
        if (action === 'add') {
            json(res, 200, await addPlaylistTracks(client, userId, name, stringValue(body.query)));
            return;
        }
        if (action === 'remove') {
            json(res, 200, await removePlaylistTrack(client, userId, name, stringValue(body.key)));
            return;
        }
        if (action === 'removeAt') {
            json(
                res,
                200,
                await removePlaylistTrackAt(client, userId, name, Number(body.index ?? 0))
            );
            return;
        }
        if (action === 'clear') {
            json(res, 200, await clearPlaylist(client, userId, name));
            return;
        }
        json(res, 400, { ok: false, status: 400, error: 'Unknown playlist track action' });
        return;
    }

    if (method === 'POST' && path === '/internal/playlists/load') {
        const body = await readBody(req);
        const userId = stringValue(body.userId);
        const guildId = stringValue(body.guildId);
        const name = stringValue(body.name);
        const shuffle = body.shuffle === true || body.shuffle === 'true';
        if (!userId || !guildId) {
            json(res, 400, {
                ok: false,
                status: 400,
                error: 'userId and guildId are required',
            });
            return;
        }
        json(res, 200, await loadPlaylist(client, guildId, userId, name, shuffle));
        return;
    }

    text(res, 404, 'not found');
}

/**
 * Loopback control surface for the dashboard sidecar. It never binds a
 * non-loopback interface and requires the shared control secret.
 */
export function startDashboardControl(client: BootstrapClient): void {
    if (config.dashboardMode !== 'sidecar') return;
    if (!client.isCoordinator) return;
    if (!config.dashboardControlPort) {
        client.logger.error('[dashboard] DASHBOARD_CONTROL_PORT is required in sidecar mode');
        return;
    }
    if (!config.dashboardControlSecret) {
        client.logger.error('[dashboard] DASHBOARD_CONTROL_SECRET is required in sidecar mode');
        return;
    }

    const server = http.createServer((req, res) => {
        void handleControl(client, req, res).catch(error => {
            client.logger.warn(
                `[dashboard] control ${req.method ?? ''} ${req.url ?? '/'} failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            if (!res.headersSent) {
                text(res, 500, 'internal error');
                return;
            }
            res.end();
        });
    });
    server.on('error', error => {
        client.logger.error(`[dashboard] control server error: ${error.message}`);
    });
    server.listen(config.dashboardControlPort, '127.0.0.1', () => {
        client.logger.info(
            `[dashboard] sidecar control http://127.0.0.1:${config.dashboardControlPort}`
        );
    });
}
