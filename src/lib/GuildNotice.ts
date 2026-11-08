import { EmbedBuilder, Guild, TextChannel } from 'discord.js';

import { BootstrapClient } from '../core/index.js';

/**
 * Post a join/leave notice to the configured log channel.
 *
 * The two guild lifecycle events differ only in wording, color, and which
 * timestamp they show; keeping the field layout here prevents them drifting.
 */
export async function postGuildNotice(
    client: BootstrapClient,
    guild: Guild,
    kind: 'joined' | 'removed'
): Promise<unknown> {
    if (!client.config.logChannelId) return;
    const owner = await guild.fetchOwner().catch(() => null);
    const joined = kind === 'joined';
    const timestamp = joined ? guild.joinedTimestamp : Date.now();
    const embed = new EmbedBuilder()
        .setColor(joined ? client.config.color.green : client.config.color.red)
        .setAuthor({
            name: guild.name || 'Unknown Guild',
            iconURL: guild.iconURL({ extension: 'jpeg' }) ?? undefined,
        })
        .setDescription(
            `**${guild.name}** has been ${joined ? 'added to' : 'removed from'} my guilds!`
        )
        .setThumbnail(guild.iconURL({ extension: 'jpeg' }))
        .addFields(
            { name: 'Owner', value: owner?.user.tag ?? 'Unknown', inline: true },
            { name: 'Members', value: guild.memberCount?.toString() ?? 'Unknown', inline: true },
            {
                name: 'Created At',
                value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                inline: true,
            },
            {
                name: joined ? 'Joined At' : 'Removed At',
                value: `<t:${Math.floor(timestamp / 1000)}:F>`,
                inline: true,
            },
            { name: 'ID', value: guild.id, inline: true }
        )
        .setTimestamp();

    const channel = await client.channels.fetch(client.config.logChannelId).catch(() => null);
    if (!(channel instanceof TextChannel)) return;
    return await channel.send({ embeds: [embed] });
}
