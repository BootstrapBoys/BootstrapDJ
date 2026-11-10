import http from 'node:http';
import https from 'node:https';

import type { NodeOption } from 'shoukaku';

import type { BootstrapClient } from '../core/index.js';

export interface AudioTapTarget {
    url: URL;
    password: string;
}

/** The configured fields needed to build a node's Lavalink HTTP base URL. */
export type AudioTapNode = Pick<NodeOption, 'url' | 'auth' | 'secure'>;

/**
 * Build the Lavalink-native tap target from the active node's configured
 * endpoint. The node URL/password are server-side config, never browser input.
 */
export function resolveAudioTapTarget(
    node: AudioTapNode | null | undefined
): AudioTapTarget | null {
    if (!node) return null;
    const rawUrl = node.url?.trim() ?? '';
    const password = node.auth?.trim() ?? '';
    if (!rawUrl || !password) return null;

    const candidate = rawUrl.includes('://')
        ? rawUrl
        : `${node.secure ? 'https' : 'http'}://${rawUrl}`;

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.search = '';
    url.hash = '';

    return { url, password };
}

/** Resolve the tap target for the node that owns this guild's player. */
export function audioTapTargetFor(client: BootstrapClient, guildId: string): AudioTapTarget | null {
    const active = client.queue.get(guildId)?.node ?? client.queue.node;
    if (!active) return null;
    const configured = client.config.lavalink.find(node => node.name === active.name);
    return resolveAudioTapTarget(configured);
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
            path: basePath + '/v4/audiotap/' + encodeURIComponent(guildId),
            headers: {
                authorization: target.password,
                accept: 'application/octet-stream',
            },
        },
        upstreamRes => {
            const status = upstreamRes.statusCode ?? 502;
            // A node without the 0.3 tap route is unsupported; do not let the
            // dashboard mistake it for a player/auth failure and retry forever.
            const mappedStatus = status === 404 || status === 405 || status === 501 ? 501 : status;
            res.writeHead(mappedStatus, {
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
            res.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
            res.end('audio tap unavailable on this node');
            return;
        }
        res.destroy();
    });

    res.on('close', () => upstream.destroy());
    upstream.end();
}
