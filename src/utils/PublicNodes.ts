import { NodeOption } from 'shoukaku';

/**
 * Public Lavalink nodes from lavalink.darrennathanael.com.
 *
 * The list API (refreshed every ~10 minutes) only guarantees the entry exists,
 * not that the node answers — in testing most entries refused connections or
 * timed out. Every candidate is probed here before it is used, and the name is
 * prefixed so node events and the watchdog can tell a fallback from the
 * operator's own node.
 */

export const FALLBACK_PREFIX = 'public-';
const CACHE_MS = 10 * 60_000;

export interface PublicNodeEntry {
    identifier: string;
    host: string;
    port: number;
    password: string;
    secure: boolean;
    version: string;
}

export interface ProbeResult {
    entry: PublicNodeEntry;
    latencyMs: number;
    players: number;
}

interface CacheEntry {
    at: number;
    nodes: PublicNodeEntry[];
}

let cache: CacheEntry | null = null;

// A public node that dropped us once should not be picked again immediately;
// the list is small and the same "best" node would otherwise be retried.
const BLOCK_MS = 5 * 60_000;
const blocked = new Map<string, number>();

export function markFallbackFailed(name: string): void {
    blocked.set(name, Date.now());
}

export function isFallbackBlocked(name: string): boolean {
    const at = blocked.get(name);
    if (!at) return false;
    if (Date.now() - at > BLOCK_MS) {
        blocked.delete(name);
        return false;
    }
    return true;
}

export function parsePublicNodes(payload: unknown): PublicNodeEntry[] {
    if (!Array.isArray(payload)) return [];

    const nodes: PublicNodeEntry[] = [];
    for (const raw of payload) {
        if (!raw || typeof raw !== 'object') continue;
        const record = raw as Record<string, unknown>;
        const host = typeof record.host === 'string' ? record.host.trim() : '';
        const password = typeof record.password === 'string' ? record.password : '';
        const port = Number(record.port);
        if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
        if (record.version !== 'v4') continue;
        // NodeLink answers /v4/info but wraps load results in `data`, which
        // Lavalink v4 clients (us) cannot parse — playback would fail silently.
        const identifier = typeof record.identifier === 'string' ? record.identifier : '';
        if (/nodelink/i.test(identifier) || /nodelink/i.test(host)) continue;

        nodes.push({
            identifier:
                typeof record.identifier === 'string' && record.identifier.trim()
                    ? record.identifier.trim()
                    : `${host}-${port}`,
            host,
            port,
            password,
            secure: record.secure === true,
            version: 'v4',
        });
    }
    return nodes;
}

export function toNodeOption(entry: PublicNodeEntry): NodeOption {
    return {
        name: `${FALLBACK_PREFIX}${entry.identifier}`.slice(0, 64),
        url: `${entry.host}:${entry.port}`,
        auth: entry.password,
        secure: entry.secure,
    };
}

export function isFallbackNode(name: string): boolean {
    return name.startsWith(FALLBACK_PREFIX);
}

/** Lower is better: a loaded node costs more than a slightly slower one. */
export function scoreNode(probe: ProbeResult): number {
    return probe.latencyMs + probe.players * 20;
}

export function rankNodes(probes: ProbeResult[]): ProbeResult[] {
    return [...probes].sort((a, b) => scoreNode(a) - scoreNode(b));
}

export function shouldFallback(waitMs: number, afterSeconds: number, hasFallback: boolean): boolean {
    if (hasFallback) return false;
    if (afterSeconds <= 0) return false;
    return waitMs >= afterSeconds * 1000;
}

export async function fetchPublicNodes(
    url: string,
    timeoutMs: number = 8_000
): Promise<PublicNodeEntry[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.nodes;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const nodes = parsePublicNodes(await res.json());
        cache = { at: Date.now(), nodes };
        return nodes;
    } finally {
        clearTimeout(timer);
    }
}

export async function probeNode(
    entry: PublicNodeEntry,
    timeoutMs: number = 3_000
): Promise<ProbeResult | null> {
    const scheme = entry.secure ? 'https' : 'http';
    const base = `${scheme}://${entry.host}:${entry.port}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const started = Date.now();
        const info = await fetch(`${base}/v4/info`, {
            headers: { Authorization: entry.password },
            signal: controller.signal,
        });
        if (!info.ok) return null;
        const latencyMs = Date.now() - started;

        let players = 0;
        try {
            const stats = await fetch(`${base}/v4/stats`, {
                headers: { Authorization: entry.password },
                signal: controller.signal,
            });
            if (stats.ok) {
                const body = (await stats.json()) as { players?: number };
                if (typeof body.players === 'number') players = body.players;
            }
        } catch {
            // Stats are a bonus; a node that answers /v4/info is usable.
        }

        return { entry, latencyMs, players };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Probe candidates in small batches; the fastest usable node wins. */
export async function findBestPublicNode(
    url: string,
    options: { batchSize?: number; timeoutMs?: number } = {}
): Promise<ProbeResult | null> {
    const batchSize = options.batchSize ?? 4;
    const nodes = await fetchPublicNodes(url);
    const usable: ProbeResult[] = [];

    for (let i = 0; i < nodes.length; i += batchSize) {
        const batch = nodes.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(node => probeNode(node, options.timeoutMs)));
        for (const result of results) if (result) usable.push(result);
    }

    const ranked = rankNodes(usable).filter(probe => !isFallbackBlocked(toNodeOption(probe.entry).name));
    return ranked[0] ?? null;
}
