import type { BootstrapClient, Context } from '../structures/index.js';

/**
 * Resolve the engine for a user-facing search. Prefix commands deliberately
 * use the lighter YouTube search even when slash commands are configured for
 * Deezer; URLs ignore the engine inside Queue.search().
 */
export async function resolveSearchEngine(
    client: BootstrapClient,
    ctx: Context,
    settings?: Record<string, string>
): Promise<string> {
    if (!ctx.isInteraction) return client.config.prefixSearchEngine;
    const loaded: Record<string, string> =
        settings ?? (await client.db.getGuildSettings(ctx.guild?.id ?? '').catch(() => ({})));
    return loaded.searchtype || client.config.searchEngine;
}
