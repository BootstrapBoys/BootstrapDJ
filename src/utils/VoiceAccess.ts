import { GuildMember, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient } from '../structures/index.js';

/** True when the member may control playback: DJ mode off, Manage Server, or a
 * configured DJ role. Mirrors the check in InteractionCreate so voice commands
 * cannot bypass a DJ-only guild. */
export async function hasDjAccess(
    client: BootstrapClient,
    guildId: string,
    member: GuildMember
): Promise<boolean> {
    const dj = await client.db.getDj(guildId);
    if (!dj || !dj.mode) return true;
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    const roles = await client.db.getRoles(guildId);
    if (!roles.length) return false;
    const ids = new Set(roles.map(role => role.roleId));
    return member.roles.cache.some(role => ids.has(role.id));
}

/** Opted-out members' audio is discarded before STT. */
export async function isVoiceOptedOut(
    client: BootstrapClient,
    guildId: string,
    userId: string
): Promise<boolean> {
    const optOuts = await client.db.listVoiceOptOuts(guildId);
    return optOuts.some(entry => entry.userId === userId);
}
