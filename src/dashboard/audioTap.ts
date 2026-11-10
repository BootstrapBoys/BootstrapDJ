import http from 'node:http';
import https from 'node:https';

import config from '../config.js';
import { isLoopbackHost } from './auth.js';

export interface AudioTapTarget {
    url: URL;
    token: string;
}

/**
 * Validate an audio-tap base URL. The tap is a loopback maintenance surface;
 * a public host is refused here so a dashboard misconfiguration cannot turn
 * the proxy into an SSRF pivot.
 */
export function resolveAudioTapTarget(rawUrl: string, token: string): AudioTapTarget | null {
    if (!rawUrl || !token.trim()) return null;

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!isLoopbackHost(url.hostname)) return null;

    return { url, token };
}

/** Configured tap target, or null when dashboard audio is disabled. */
export function audioTapTarget(): AudioTapTarget | null {
    return resolveAudioTapTarget(config.dashboardTapUrl, config.dashboardTapToken);
}

/**
 * Relay one guild's tap stream to an already-authorized dashboard response.
 * The upstream status is preserved (404 when the guild has no player, 401 when
 * the token is wrong); the browser never sees the tap token.
 */
export function relayAudioTap(
    res: http.ServerResponse,
    guildId: string,
    target: AudioTapTarget
): void {
    const basePath = target.url.pathname.replace(/\/+$/, '');
    const transport = target.url.protocol === 'https:' ? https : http;

    const upstream = transport.request(
        {
            protocol: target.url.protocol,
            hostname: target.url.hostname,
            port: target.url.port || (target.url.protocol === 'https:' ? 443 : 80),
            method: 'GET',
            path: basePath + '/tap/' + encodeURIComponent(guildId),
            headers: {
                authorization: target.token,
                accept: 'application/octet-stream',
            },
        },
        upstreamRes => {
            res.writeHead(upstreamRes.statusCode ?? 502, {
                'content-type': upstreamRes.headers['content-type'] ?? 'application/octet-stream',
                'cache-control': 'no-store',
                // Nginx/Cloudflare must not buffer a live stream.
                'x-accel-buffering': 'no',
            });
            upstreamRes.pipe(res);
            upstreamRes.on('error', () => res.destroy());
        }
    );

    // The tap sends a ping at least every five seconds while paused.
    upstream.setTimeout(15_000, () => upstream.destroy(new Error('audio tap timed out')));
    upstream.on('error', () => {
        if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
            res.end('audio tap unavailable');
            return;
        }
        res.destroy();
    });

    res.on('close', () => upstream.destroy());
    upstream.end();
}
