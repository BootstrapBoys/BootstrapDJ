import { randomBytes } from 'node:crypto';
import http from 'node:http';

import config from '../config.js';
import {
    anonymousDashboardAllowed,
    authorized,
    beginSession,
    clearOAuthState,
    csrfMatches,
    discordIdentity,
    endSession,
    isLoopbackHost,
    issueCsrfToken,
    oauthEnabled,
    oauthRedirectUrl,
    oauthState,
    rateLimited,
    readSession,
    revokeSession,
    setOAuthState,
    viewer,
} from './auth.js';
import { GuildAccessCache } from './accessCache.js';
import type { DashboardHost } from './host.js';
import { renderDashboard, renderLoginPage } from './page.js';
import { type GuildAccess, NO_ACCESS } from './shardApi.js';
import { initialState, SettingValidationError } from './state.js';

const MAX_BODY_BYTES = 64_000;
const RATE_WINDOW_MS = 60_000;
const AUTH_ATTEMPTS_PER_MINUTE = 30;
const MUTATIONS_PER_MINUTE = 180;
const READS_PER_MINUTE = 300;
const ACCESS_TTL_MS = 60_000;
const ACCESS_CACHE_MAX = 1000;
const AUTH_PATHS = new Set(['/auth/discord', '/auth/callback', '/auth/logout']);

/** Per-viewer guild authorization, refreshed on a short TTL. */
const accessCache = new GuildAccessCache(ACCESS_TTL_MS, ACCESS_CACHE_MAX);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end(text);
}

function redirect(res: http.ServerResponse, location: string): void {
    res.writeHead(302, { location });
    res.end();
}

function tooManyRequests(res: http.ServerResponse, message: string): void {
    res.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '60' });
    res.end(message);
}

function guildDenied(res: http.ServerResponse): void {
    sendJson(res, 403, { error: 'Guild not permitted for this dashboard session' });
}

function securityHeaders(res: http.ServerResponse): void {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
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

function bodyText(value: unknown, fallback: string = ''): string {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : fallback;
}

/**
 * Resolve one viewer's rights in a guild. OAuth mode without a session has no
 * rights at all; token mode is the operator and therefore has every right.
 */
async function resolveAccess(
    host: DashboardHost,
    req: http.IncomingMessage,
    guildId: string,
    fresh: boolean = false
): Promise<GuildAccess> {
    const oauth = oauthEnabled();
    const session = oauth ? readSession(req) : null;
    if (oauth && !session) return NO_ACCESS;

    const cacheKey = (session?.id ?? 'token') + ':' + guildId;
    if (!fresh) {
        const cached = accessCache.get(cacheKey);
        if (cached) return cached;
    }

    const result = await host.access(session?.id ?? null, guildId);
    if (!result.found || !result.access.member) return NO_ACCESS;

    accessCache.set(cacheKey, result.access);
    return { ...result.access };
}

async function guildAllowed(
    host: DashboardHost,
    req: http.IncomingMessage,
    guildId: string
): Promise<boolean> {
    return (await resolveAccess(host, req, guildId)).member;
}

/** Playlists are owned by the signed-in Discord user; token mode uses the owner. */
function dashboardUserId(req: http.IncomingMessage): string {
    return readSession(req)?.id ?? config.owners[0] ?? 'dashboard';
}

/** OAuth callback: validate state, exchange the code, and gate on bot membership. */
async function completeOAuth(
    host: DashboardHost,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
): Promise<void> {
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const expected = oauthState(req);
    clearOAuthState(res);

    if (!code || !state || !expected || state !== expected) {
        sendText(res, 400, 'invalid oauth state');
        return;
    }

    const identity = await discordIdentity(code);
    if (!identity.ok) {
        const message =
            identity.reason === 'exchange-failed'
                ? 'discord token exchange failed'
                : identity.reason === 'missing-token'
                  ? 'discord token missing'
                  : 'discord profile lookup failed';
        sendText(res, 401, message);
        return;
    }

    const botGuilds = new Set(await host.guildIds());
    if (!identity.guilds.some(guild => botGuilds.has(guild.id))) {
        sendText(res, 403, 'you must share a guild with this bot');
        return;
    }

    beginSession(res, identity.user);
    redirect(res, '/');
}

/** Attach service icons and listener identities to the raw statistics rows. */
async function decorateStats(
    host: DashboardHost,
    data: Record<string, unknown>
): Promise<Record<string, unknown>> {
    const iconFor = (source: unknown): string | null =>
        host.config.icons[bodyText(source).toLowerCase()] ?? null;
    const rows = (value: unknown): Array<Record<string, unknown>> =>
        Array.isArray(value) ? value.filter(isRecord) : [];

    const tracks = rows(data.topTracks).map(track => ({ ...track, icon: iconFor(track.source) }));
    const sources = rows(data.sources).map(entry => ({ ...entry, icon: iconFor(entry.source) }));
    const listeners = await Promise.all(
        rows(data.topListeners).map(async entry => {
            const user = await host.user(bodyText(entry.userId));
            return {
                ...entry,
                name: user?.name ?? 'Unknown user',
                avatar: user?.avatar ?? null,
            };
        })
    );

    return { ...data, topTracks: tracks, sources, topListeners: listeners };
}

export async function route(
    host: DashboardHost,
    req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> {
    const method = req.method ?? '';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // JSON-only mutations force a CORS preflight; SameSite=Lax on its own is
    // not a complete CSRF boundary between sibling subdomains.
    if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')
    ) {
        sendText(res, 415, 'content-type must be application/json');
        return;
    }

    if (
        AUTH_PATHS.has(path) &&
        rateLimited(req, 'auth', AUTH_ATTEMPTS_PER_MINUTE, RATE_WINDOW_MS)
    ) {
        tooManyRequests(res, 'too many authentication attempts');
        return;
    }
    if (method === 'POST' && rateLimited(req, 'mutate', MUTATIONS_PER_MINUTE, RATE_WINDOW_MS)) {
        tooManyRequests(res, 'too many requests');
        return;
    }
    // Reads hit Discord caches, the database and every shard; an unauthenticated
    // caller must not be able to amplify one request into that work.
    if (
        (method === 'GET' || method === 'HEAD') &&
        rateLimited(req, 'read', READS_PER_MINUTE, RATE_WINDOW_MS)
    ) {
        tooManyRequests(res, 'too many requests');
        return;
    }

    if (method === 'GET' && path === '/auth/discord' && oauthEnabled()) {
        const state = randomBytes(24).toString('hex');
        setOAuthState(res, state);
        redirect(res, oauthRedirectUrl(state));
        return;
    }
    if (method === 'GET' && path === '/auth/callback' && oauthEnabled()) {
        await completeOAuth(host, req, res, url);
        return;
    }

    if (!authorized(req)) {
        if (oauthEnabled() && method === 'GET' && (path === '/' || path === '/index.html')) {
            res.writeHead(401, {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
            });
            res.end(renderLoginPage());
            return;
        }
        sendText(res, 401, 'unauthorized');
        return;
    }

    if (method === 'POST' && !csrfMatches(req)) {
        sendJson(res, 403, { error: 'Invalid CSRF token' });
        return;
    }

    if (method === 'POST' && path === '/auth/logout') {
        revokeSession(readSession(req));
        endSession(res);
        redirect(res, '/');
        return;
    }

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
        issueCsrfToken(req, res);
        res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
        });
        res.end(renderDashboard(oauthEnabled()));
        return;
    }

    if (method === 'GET' && path === '/api/guilds') {
        const csrf = issueCsrfToken(req, res);
        const session = oauthEnabled() ? readSession(req) : null;
        const guilds = await host.guilds(session?.id ?? null);
        sendJson(res, 200, { csrf, guilds, viewer: viewer(req) });
        return;
    }

    if (method === 'GET' && path === '/api/metrics') {
        sendJson(res, 200, await host.metrics());
        return;
    }

    if (method === 'GET' && path === '/api/player-state') {
        const guildId = url.searchParams.get('guildId') ?? '';
        if (!(await guildAllowed(host, req, guildId))) {
            guildDenied(res);
            return;
        }
        const data = await host.player(guildId);
        if (!data.found) {
            guildDenied(res);
            return;
        }
        sendJson(res, 200, { player: data.player });
        return;
    }

    if (method === 'GET' && path === '/api/state') {
        const guildId = url.searchParams.get('guildId') ?? '';
        const access = await resolveAccess(host, req, guildId);
        if (!access.member) {
            guildDenied(res);
            return;
        }
        const remote = await host.player(guildId);
        if (!remote.found) {
            guildDenied(res);
            return;
        }
        const data = initialState(guildId, remote.player);
        data.permissions = access;
        data.settings = access.settings ? await host.settings(guildId) : {};
        sendJson(res, 200, data);
        return;
    }

    if (method === 'POST' && path === '/api/settings') {
        const body = await readBody(req);
        const guildId = bodyText(body.guildId);
        if (!(await resolveAccess(host, req, guildId, true)).settings) {
            guildDenied(res);
            return;
        }
        try {
            if (isRecord(body.settings)) {
                const values: Record<string, string> = {};
                for (const [key, value] of Object.entries(body.settings)) {
                    values[key] = bodyText(value);
                }
                await host.saveSettings(guildId, values);
            } else {
                await host.saveSettings(guildId, {
                    [bodyText(body.key)]: bodyText(body.value),
                });
            }
        } catch (error) {
            if (error instanceof SettingValidationError) {
                sendJson(res, 400, { error: error.message });
                return;
            }
            throw error;
        }
        accessCache.invalidateGuild(guildId);
        sendJson(res, 200, { ok: true, settings: await host.settings(guildId) });
        return;
    }

    if (method === 'POST' && path === '/api/filter') {
        const body = await readBody(req);
        const guildId = bodyText(body.guildId);
        if (!(await resolveAccess(host, req, guildId, true)).settings) {
            guildDenied(res);
            return;
        }
        const value = body.value === undefined ? undefined : Number(body.value);
        const result = await host.filter(
            guildId,
            bodyText(body.filter),
            Boolean(body.enabled),
            value
        );
        if (!result.found || result.error) {
            sendJson(res, result.status ?? (result.found ? 400 : 404), {
                error: result.error ?? 'Filter update failed',
            });
            return;
        }
        accessCache.invalidateGuild(guildId);
        sendJson(res, 200, { ok: true, filters: { active: result.active } });
        return;
    }

    if (method === 'GET' && path === '/api/me/stats') {
        const guildId = url.searchParams.get('guildId') ?? '';
        if (!(await resolveAccess(host, req, guildId)).member) {
            guildDenied(res);
            return;
        }
        const session = readSession(req);
        if (!session) {
            sendJson(res, 401, { error: 'Personal statistics require Discord login' });
            return;
        }
        sendJson(res, 200, await host.userStats(guildId, session.id));
        return;
    }

    if (method === 'GET' && path === '/api/stats') {
        const guildId = url.searchParams.get('guildId') ?? '';
        if (!(await guildAllowed(host, req, guildId))) {
            guildDenied(res);
            return;
        }
        const requested = Number(url.searchParams.get('days') ?? 7);
        const days = Number.isFinite(requested)
            ? Math.min(90, Math.max(1, Math.floor(requested)))
            : 7;
        const stats = await host.stats(guildId, days);
        sendJson(res, 200, await decorateStats(host, stats));
        return;
    }

    if (method === 'POST' && path === '/api/stats/clear') {
        const body = await readBody(req);
        const guildId = bodyText(body.guildId);
        const access = await resolveAccess(host, req, guildId, true);
        if (!access.member) {
            guildDenied(res);
            return;
        }
        if (!access.owner) {
            sendJson(res, 403, { error: 'Only the server owner can clear statistics' });
            return;
        }
        const removed = await host.clearStats(guildId);
        accessCache.invalidateGuild(guildId);
        sendJson(res, 200, { ok: true, removed });
        return;
    }

    if (method === 'GET' && path === '/api/playlists') {
        const userId = dashboardUserId(req);
        sendJson(res, 200, { playlists: await host.playlists(userId) });
        return;
    }

    if (method === 'POST' && path === '/api/playlists') {
        const body = await readBody(req);
        const userId = dashboardUserId(req);
        const action = bodyText(body.action);
        const name = bodyText(body.name);
        let result;
        if (action === 'create') {
            result = await host.createPlaylist(userId, name);
        } else if (action === 'rename') {
            result = await host.renamePlaylist(userId, name, bodyText(body.newName));
        } else if (action === 'delete') {
            result = await host.deletePlaylist(userId, name);
        } else {
            sendJson(res, 400, { ok: false, error: 'Unknown playlist action' });
            return;
        }
        sendJson(res, result.ok ? 200 : (result.status ?? 400), result);
        return;
    }

    if (method === 'GET' && path === '/api/playlists/tracks') {
        const userId = dashboardUserId(req);
        const name = url.searchParams.get('name') ?? '';
        sendJson(res, 200, { tracks: await host.playlistTracks(userId, name) });
        return;
    }

    if (method === 'POST' && path === '/api/playlists/tracks') {
        const body = await readBody(req);
        const userId = dashboardUserId(req);
        const name = bodyText(body.name);
        const action = bodyText(body.action);
        let result;
        if (action === 'add') {
            result = await host.addPlaylistTracks(userId, name, bodyText(body.query));
        } else if (action === 'remove') {
            result = await host.removePlaylistTrack(userId, name, bodyText(body.key));
        } else if (action === 'removeAt') {
            result = await host.removePlaylistTrackAt(userId, name, Number(body.index ?? 0));
        } else if (action === 'clear') {
            result = await host.clearPlaylist(userId, name);
        } else {
            sendJson(res, 400, { ok: false, error: 'Unknown playlist track action' });
            return;
        }
        sendJson(res, result.ok ? 200 : (result.status ?? 400), result);
        return;
    }

    if (method === 'POST' && path === '/api/playlists/load') {
        const body = await readBody(req);
        const guildId = bodyText(body.guildId);
        const name = bodyText(body.name);
        const access = await resolveAccess(host, req, guildId, true);
        if (!access.member) {
            guildDenied(res);
            return;
        }
        if (!access.controls) {
            sendJson(res, 403, {
                ok: false,
                error: 'Playback controls are required to load a playlist.',
            });
            return;
        }
        const result = await host.loadPlaylist(guildId, dashboardUserId(req), name);
        sendJson(res, result.ok ? 200 : (result.status ?? 400), result);
        return;
    }

    if (method === 'POST' && path === '/api/player') {
        const body = await readBody(req);
        const guildId = bodyText(body.guildId);
        if (!(await resolveAccess(host, req, guildId, true)).controls) {
            guildDenied(res);
            return;
        }
        const result = await host.playerAction(
            guildId,
            bodyText(body.action),
            Number(body.value ?? 0)
        );
        if (!result.ok) {
            sendJson(res, result.status ?? (result.found ? 400 : 404), {
                error: result.error ?? 'Player action failed',
            });
            return;
        }
        accessCache.invalidateGuild(guildId);
        const updated = await host.player(guildId);
        sendJson(res, 200, { ok: true, player: updated.player });
        return;
    }

    sendText(res, 404, 'not found');
}

async function handle(
    host: DashboardHost,
    req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> {
    securityHeaders(res);
    try {
        await route(host, req, res);
    } catch (error) {
        host.logger.warn(
            `[dashboard] ${req.method} ${req.url ?? '/'} failed: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        if (res.headersSent) {
            res.end();
            return;
        }
        sendText(res, 500, 'request failed');
    }
}

export function startDashboard(host: DashboardHost): void {
    if (!config.dashboardPort) return;

    const hostName = config.dashboardHost;
    const loopback = isLoopbackHost(hostName);
    if (!loopback && !config.dashboardToken && !oauthEnabled()) {
        host.logger.error(
            '[dashboard] refusing non-loopback bind without DASHBOARD_TOKEN or Discord OAuth'
        );
        return;
    }
    if (!config.dashboardToken && !oauthEnabled() && !anonymousDashboardAllowed()) {
        host.logger.error(
            '[dashboard] refusing to start without authentication: configure DASHBOARD_TOKEN or Discord OAuth, or opt in with DASHBOARD_ALLOW_ANONYMOUS=1 on a loopback bind with no DASHBOARD_PUBLIC_URL'
        );
        return;
    }

    const server = http.createServer((req, res) => {
        void handle(host, req, res);
    });
    server.on('error', error => {
        host.logger.error(`[dashboard] server error: ${error.message}`);
    });
    server.listen(config.dashboardPort, hostName, () => {
        host.logger.info(`[dashboard] http://${hostName}:${config.dashboardPort}`);
    });
}
