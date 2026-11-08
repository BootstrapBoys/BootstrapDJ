import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import { isIP } from 'node:net';

import config from '../config.js';

/** Signed-in Discord user, as stored in the dashboard session cookie. */
export interface DashboardSession {
    id: string;
    name: string;
    avatar: string | null;
    exp: number;
    sid: string;
}

export interface DiscordUser {
    id: string;
    username: string;
    avatar: string | null;
}

export interface DiscordGuildSummary {
    id: string;
    owner?: boolean;
    permissions?: string;
}

export type DiscordIdentity =
    | { ok: true; user: DiscordUser; guilds: DiscordGuildSummary[] }
    | { ok: false; reason: 'exchange-failed' | 'missing-token' | 'profile-failed' };

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const SESSION_COOKIE = 'bdj_session';
const CSRF_COOKIE = 'bdj_csrf';
const CSRF_HEADER = 'x-dashboard-csrf';
const OAUTH_STATE_COOKIE = 'bdj_oauth_state';

/** Sessions revoked in this process. Rotating the secret revokes all of them. */
const revokedSessions = new Map<string, number>();
const rateBuckets = new Map<string, { count: number; reset: number }>();

/** Hard ceiling for rate-limit buckets so a hostile client cannot grow them. */
export const RATE_BUCKET_MAX = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Cookie payloads are attacker-reachable until the signature is verified. */
function parseSession(value: unknown): DashboardSession | null {
    if (!isRecord(value)) return null;
    const { id, name, avatar, exp } = value;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof exp !== 'number') return null;
    if (avatar !== null && avatar !== undefined && typeof avatar !== 'string') return null;
    return {
        id,
        name,
        avatar: typeof avatar === 'string' ? avatar : null,
        exp,
        sid: typeof value.sid === 'string' ? value.sid : '',
    };
}

function parseAccessToken(value: unknown): string {
    return isRecord(value) && typeof value.access_token === 'string' ? value.access_token : '';
}

function parseDiscordUser(value: unknown): DiscordUser | null {
    if (!isRecord(value)) return null;
    const { id, username, avatar } = value;
    if (typeof id !== 'string' || typeof username !== 'string') return null;
    if (avatar !== null && avatar !== undefined && typeof avatar !== 'string') return null;
    return { id, username, avatar: typeof avatar === 'string' ? avatar : null };
}

function parseDiscordGuilds(value: unknown): DiscordGuildSummary[] | null {
    if (!Array.isArray(value)) return null;
    const guilds: DiscordGuildSummary[] = [];
    for (const entry of value) {
        if (!isRecord(entry) || typeof entry.id !== 'string') continue;
        const guild: DiscordGuildSummary = { id: entry.id };
        if (typeof entry.owner === 'boolean') guild.owner = entry.owner;
        if (typeof entry.permissions === 'string') guild.permissions = entry.permissions;
        guilds.push(guild);
    }
    return guilds;
}

export function oauthEnabled(): boolean {
    return Boolean(
        config.dashboardOAuthClientId &&
        config.dashboardOAuthClientSecret &&
        config.dashboardOAuthRedirectUri &&
        config.dashboardSessionSecret
    );
}

/** Any OAuth value means auth is intended; incomplete config must fail closed. */
export function oauthConfigured(): boolean {
    // CLIENT_ID/GUILD_ID fallbacks exist for the bot, not for the dashboard:
    // treating them as OAuth intent would lock a token-mode dashboard out.
    return Boolean(
        process.env.DASHBOARD_OAUTH_CLIENT_ID ||
        config.dashboardOAuthClientSecret ||
        config.dashboardOAuthRedirectUri ||
        config.dashboardSessionSecret
    );
}

/** Normalize an IP literal, dropping an optional port and IPv6 brackets. */
function normalizeAddress(value: string | undefined): string | null {
    let candidate = (value ?? '').trim();
    if (!candidate) return null;
    if (candidate.startsWith('[')) {
        const end = candidate.indexOf(']');
        if (end > 0) candidate = candidate.slice(1, end);
    } else {
        const first = candidate.indexOf(':');
        if (first > 0 && first === candidate.lastIndexOf(':')) {
            // Exactly one colon: IPv4 with a port, never a bare IPv6 literal.
            candidate = candidate.slice(0, first);
        }
    }
    if (isIP(candidate) === 0) return null;
    return candidate.toLowerCase();
}

export function isLoopbackAddress(value: string): boolean {
    const address = value.replace(/^::ffff:/i, '').toLowerCase();
    if (address === '::1' || address === 'localhost') return true;
    return /^127(?:\.\d{1,3}){3}$/.test(address);
}

/**
 * Client identity for rate limiting.
 *
 * `X-Forwarded-For` is only trusted when the immediate peer is loopback (a
 * reverse proxy on the same host). Trusting it from any peer let a caller mint
 * a new bucket per request and bypass every limit. When the header is used, the
 * last hop is the address the proxy actually saw; earlier entries are
 * caller-controlled.
 */
export function clientAddress(req: http.IncomingMessage): string {
    const socket = normalizeAddress(req.socket.remoteAddress ?? '');
    if (!socket) return 'unknown';
    if (!isLoopbackAddress(socket)) return socket;

    const header = req.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header[header.length - 1] : header;
    const hops = (raw ?? '')
        .split(',')
        .map(hop => normalizeAddress(hop))
        .filter((hop): hop is string => hop !== null);
    return hops.length > 0 ? hops[hops.length - 1] : socket;
}

/** A bind that only accepts local callers. */
export function isLoopbackHost(host: string): boolean {
    const value = host.trim().toLowerCase();
    return value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';
}

export interface AnonymousAccessInput {
    allowAnonymous: boolean;
    /** DASHBOARD_PUBLIC_URL: set when the port is served through a proxy. */
    publicUrl: string;
    host: string;
}

/**
 * Anonymous access is an explicit, loopback-only opt-in.
 *
 * A configured public URL proves the port is proxied, so a loopback bind no
 * longer identifies the caller. Without the flag, an unauthenticated request is
 * refused rather than granted owner rights.
 */
export function anonymousAccessAllowed(input: AnonymousAccessInput): boolean {
    if (!input.allowAnonymous) return false;
    if (input.publicUrl.trim()) return false;
    return isLoopbackHost(input.host);
}

export function anonymousDashboardAllowed(): boolean {
    return anonymousAccessAllowed({
        allowAnonymous: config.dashboardAllowAnonymous,
        publicUrl: config.dashboardPublicUrl,
        host: config.dashboardHost,
    });
}

/** Drop expired buckets, then keep the map under the hard ceiling. */
function pruneRateBuckets(now: number): void {
    for (const [key, bucket] of rateBuckets) {
        if (bucket.reset <= now) rateBuckets.delete(key);
    }
    while (rateBuckets.size > RATE_BUCKET_MAX) {
        const oldest = rateBuckets.keys().next();
        if (oldest.done) break;
        rateBuckets.delete(oldest.value);
    }
}

export function rateBucketCount(): number {
    return rateBuckets.size;
}

export function rateLimited(
    req: http.IncomingMessage,
    name: string,
    limit: number,
    windowMs: number
): boolean {
    const now = Date.now();
    const key = `${name}:${clientAddress(req)}`;
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.reset <= now) {
        rateBuckets.set(key, { count: 1, reset: now + windowMs });
        pruneRateBuckets(now);
        return false;
    }
    bucket.count += 1;
    // Re-insert to refresh LRU order so an active bucket is not evicted.
    rateBuckets.delete(key);
    rateBuckets.set(key, bucket);
    pruneRateBuckets(now);
    return bucket.count > limit;
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) continue;
        const key = part.slice(0, separator).trim();
        const raw = part.slice(separator + 1).trim();
        try {
            parsed[key] = decodeURIComponent(raw);
        } catch {
            parsed[key] = raw;
        }
    }
    return parsed;
}

export function readCookie(req: http.IncomingMessage, name: string): string | null {
    return parseCookies(req)[name] ?? null;
}

function appendCookie(res: http.ServerResponse, cookie: string): void {
    const current = res.getHeader('set-cookie');
    if (Array.isArray(current)) res.setHeader('set-cookie', [...current, cookie]);
    else if (typeof current === 'string') res.setHeader('set-cookie', [current, cookie]);
    else res.setHeader('set-cookie', cookie);
}

export function setCookie(
    res: http.ServerResponse,
    name: string,
    value: string,
    maxAge: number,
    httpOnly: boolean = true,
    sameSite: 'Lax' | 'Strict' = 'Lax'
): void {
    const secure = config.dashboardOAuthRedirectUri.startsWith('https://') ? '; Secure' : '';
    appendCookie(
        res,
        `${name}=${encodeURIComponent(value)}; Path=/;${httpOnly ? ' HttpOnly;' : ''} SameSite=${sameSite}; Max-Age=${maxAge}${secure}`
    );
}

export function issueCsrfToken(req: http.IncomingMessage, res: http.ServerResponse): string {
    const existing = readCookie(req, CSRF_COOKIE);
    if (existing && /^[A-Za-z0-9_-]{32,}$/.test(existing)) return existing;
    const token = randomBytes(24).toString('base64url');
    setCookie(res, CSRF_COOKIE, token, SESSION_TTL_SECONDS, false, 'Strict');
    return token;
}

export function csrfMatches(req: http.IncomingMessage): boolean {
    const cookie = readCookie(req, CSRF_COOKIE) ?? '';
    const header = req.headers[CSRF_HEADER];
    const supplied = Array.isArray(header) ? header[0] : (header ?? '');
    return Boolean(cookie && supplied && cookie === supplied);
}

function signature(payload: string): string {
    return createHmac('sha256', config.dashboardSessionSecret).update(payload).digest('base64url');
}

export function createSession(user: DiscordUser): string {
    const payload = Buffer.from(
        JSON.stringify({
            id: user.id,
            name: user.username,
            avatar: user.avatar,
            exp: Date.now() + SESSION_TTL_SECONDS * 1000,
            sid: randomBytes(16).toString('hex'),
        })
    ).toString('base64url');
    return `${payload}.${signature(payload)}`;
}

export function readSession(req: http.IncomingMessage): DashboardSession | null {
    if (!config.dashboardSessionSecret) return null;
    const raw = readCookie(req, SESSION_COOKIE);
    if (!raw) return null;
    const [payload, provided] = raw.split('.');
    if (!payload || !provided) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(provided)) return null;

    const expected = Buffer.from(signature(payload), 'base64url');
    const actual = Buffer.from(provided, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    try {
        const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
        const session = parseSession(parsed);
        if (!session || !session.id || !session.exp || session.exp < Date.now()) return null;
        if (session.sid && revokedSessions.has(session.sid)) return null;
        return session;
    } catch {
        return null;
    }
}

export function revokeSession(session: DashboardSession | null): void {
    if (!session?.sid) return;
    revokedSessions.set(session.sid, session.exp);
    if (revokedSessions.size <= 1000) return;
    const now = Date.now();
    for (const [sid, exp] of revokedSessions) {
        if (exp < now) revokedSessions.delete(sid);
    }
}

/**
 * Resolve the operator identity for a request with no signed session.
 *
 * Token mode is the operator; anonymous mode counts as the operator only when
 * it was explicitly enabled on a loopback bind. An unauthenticated request in
 * any other configuration has no rights at all.
 */
function operatorRequest(): boolean {
    if (oauthEnabled() || oauthConfigured()) return false;
    return Boolean(config.dashboardToken) || anonymousDashboardAllowed();
}

export function viewer(req: http.IncomingMessage): {
    name: string;
    owner: boolean;
    admin: boolean;
} {
    const session = readSession(req);
    if (session) return { name: session.name, owner: false, admin: true };
    if (operatorRequest()) return { name: 'Local admin', owner: true, admin: true };
    return { name: 'Unauthenticated', owner: false, admin: false };
}

/** Token mode accepts a header/bearer value; OAuth mode requires a session. */
export function authorized(req: http.IncomingMessage): boolean {
    if (oauthEnabled()) return Boolean(readSession(req));
    if (oauthConfigured()) return false;
    if (!config.dashboardToken) return anonymousDashboardAllowed();
    const header = req.headers['x-dashboard-token'];
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    return header === config.dashboardToken || bearer === config.dashboardToken;
}

export function setOAuthState(res: http.ServerResponse, state: string): void {
    setCookie(res, OAUTH_STATE_COOKIE, state, 600);
}

export function oauthState(req: http.IncomingMessage): string {
    return readCookie(req, OAUTH_STATE_COOKIE) ?? '';
}

export function clearOAuthState(res: http.ServerResponse): void {
    setCookie(res, OAUTH_STATE_COOKIE, '', 0);
}

/** Attach a fresh signed session cookie to the response. */
export function beginSession(res: http.ServerResponse, user: DiscordUser): void {
    setCookie(res, SESSION_COOKIE, createSession(user), SESSION_TTL_SECONDS);
}

/** Drop both auth cookies; the caller redirects. */
export function endSession(res: http.ServerResponse): void {
    setCookie(res, SESSION_COOKIE, '', 0);
    setCookie(res, CSRF_COOKIE, '', 0, false, 'Strict');
}

export function oauthRedirectUrl(state: string): string {
    const params = new URLSearchParams({
        client_id: config.dashboardOAuthClientId,
        redirect_uri: config.dashboardOAuthRedirectUri,
        response_type: 'code',
        scope: 'identify guilds',
        state,
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code, then load the profile and guild list with the
 * resulting access token. The caller decides whether the user may enter.
 */
export async function discordIdentity(code: string): Promise<DiscordIdentity> {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.dashboardOAuthClientId,
            client_secret: config.dashboardOAuthClientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.dashboardOAuthRedirectUri,
        }),
    });
    if (!tokenResponse.ok) return { ok: false, reason: 'exchange-failed' };

    const accessToken = parseAccessToken(await tokenResponse.json());
    if (!accessToken) return { ok: false, reason: 'missing-token' };

    const headers = { Authorization: 'Bearer ' + accessToken };
    const [userResponse, guildsResponse] = await Promise.all([
        fetch('https://discord.com/api/users/@me', { headers }),
        fetch('https://discord.com/api/users/@me/guilds', { headers }),
    ]);
    if (!userResponse.ok || !guildsResponse.ok) return { ok: false, reason: 'profile-failed' };

    const user = parseDiscordUser(await userResponse.json());
    const guilds = parseDiscordGuilds(await guildsResponse.json());
    if (!user || !guilds) return { ok: false, reason: 'profile-failed' };
    return { ok: true, user, guilds };
}
