import { NodeOption } from 'shoukaku';

import { isFallbackNode } from './PublicNodes.js';

export interface ConfiguredNode {
    name: string;
    url: string;
    auth: string;
    secure: boolean;
}

/**
 * LAVALINK_FALLBACKS is a JSON array of additional nodes, tried in order after
 * the primary (LAVALINK_URL) and before any public node:
 *   [{"name":"eu-1","url":"lava.example.com:443","auth":"pass","secure":true}]
 */
export function parseFallbackNodes(raw: string | undefined): ConfiguredNode[] {
    if (!raw || !raw.trim()) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const nodes: ConfiguredNode[] = [];
    parsed.forEach((value, index) => {
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        const url = typeof record.url === 'string' ? record.url.trim() : '';
        if (!url) return;

        const name =
            typeof record.name === 'string' && record.name.trim()
                ? record.name.trim()
                : `fallback-${index + 1}`;
        nodes.push({
            name,
            url,
            auth: typeof record.auth === 'string' ? record.auth : '',
            secure: record.secure === true,
        });
    });
    return nodes;
}

export function toNodeOptions(
    primary: ConfiguredNode | null,
    fallbacks: ConfiguredNode[]
): NodeOption[] {
    const nodes: NodeOption[] = [];
    if (primary && primary.url) {
        nodes.push({
            name: primary.name,
            url: primary.url,
            auth: primary.auth,
            secure: primary.secure,
        });
    }
    for (const fallback of fallbacks) {
        nodes.push({
            name: fallback.name,
            url: fallback.url,
            auth: fallback.auth,
            secure: fallback.secure,
        });
    }
    return nodes;
}

/**
 * Lower wins. Configured nodes keep their env order (primary first, then
 * fallbacks); anything not configured (a public node) always ranks last.
 */
export function nodePriority(name: string, configuredNames: string[]): number {
    const index = configuredNames.indexOf(name);
    if (index !== -1) return index;
    return 1000 + (isFallbackNode(name) ? 0 : 1);
}

/** The first configured node is the one incidents and recovery messages track. */
export function isPrimaryNode(name: string, configuredNames: string[]): boolean {
    return configuredNames.length > 0 && configuredNames[0] === name;
}
