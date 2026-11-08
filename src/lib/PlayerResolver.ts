import type { GuildBasedChannel } from 'discord.js';

import type { BootstrapClient, Dispatcher } from '../core/index.js';

/**
 * Return a live dispatcher for a guild, rebuilding one whose Lavalink player
 * was dropped or moved to a new session. Commands used to receive the stale
 * object from `queue.get()` and reply "done" while mutating a player nobody
 * could hear.
 *
 * A missing player stays missing: callers own the "nothing playing" reply.
 * A stale player that cannot be rebuilt is an error, never a silent success.
 */
export async function resolvePlayer(
    client: BootstrapClient,
    guildId: string,
    voiceChannel: GuildBasedChannel | null,
    textChannel: GuildBasedChannel | null
): Promise<Dispatcher | undefined> {
    const existing = client.queue.get(guildId);
    if (!existing) return undefined;
    if (!existing.isStale) return existing;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return existing;
    const storedVoice = existing?.voiceId
        ? (guild.channels.cache.get(existing.voiceId) ?? null)
        : null;
    const storedText = existing
        ? (guild.channels.cache.get(existing.channelId) ?? null)
        : null;
    const voice = voiceChannel ?? storedVoice;
    const text = textChannel ?? storedText;

    if (!voice || !text || !client.queue.hasNode) {
        if (!existing) return undefined;
        throw new Error(
            'The current player is stale and cannot be rebuilt because no Lavalink node or channel is available'
        );
    }
    return await client.queue.create(guild, voice, text);
}

/** Rebuild a stale player before a command that declared player preconditions. */
export async function refreshStalePlayer(
    client: BootstrapClient,
    command: { player?: { voice?: boolean; active?: boolean } | null },
    guildId: string,
    voiceChannel: GuildBasedChannel | null,
    textChannel: GuildBasedChannel | null
): Promise<void> {
    if (!command.player?.voice && !command.player?.active) return;
    if (!client.queue.get(guildId)?.isStale) return;
    await resolvePlayer(client, guildId, voiceChannel, textChannel);
}
