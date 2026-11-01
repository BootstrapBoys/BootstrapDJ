import { GuildMember, PermissionFlagsBits, Routes } from 'discord.js';

import { BootstrapClient } from '../structures/index.js';

/** Server-mute (or unmute) a member through Discord's voice-state endpoint.
 * Only called for members currently in a voice channel; a bot without Mute
 * Members gets a readable error instead of a silent no-op. */
export async function setServerMute(
    client: BootstrapClient,
    guildId: string,
    userId: string,
    mute: boolean
): Promise<{ ok: boolean; error?: string }> {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, error: 'unknown guild' };
    const member: GuildMember | null = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { ok: false, error: 'unknown member' };
    if (!member.voice.channelId) {
        return mute ? { ok: false, error: 'member is not in a voice channel' } : { ok: true };
    }
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!me?.permissions.has(PermissionFlagsBits.MuteMembers)) {
        return { ok: false, error: 'missing Mute Members permission' };
    }
    try {
        await client.rest.put(Routes.guildVoiceState(guildId, userId), { body: { mute } });
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
