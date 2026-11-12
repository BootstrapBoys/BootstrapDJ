import { EmbedBuilder, Guild, TextChannel } from 'discord.js';

import { BootstrapClient } from '../core/index.js';
import { DEFAULT_LANGUAGE, translate } from './i18n.js';

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
    const language = client.config.defaultLanguage ?? DEFAULT_LANGUAGE;
    const copy = (key: string, variables: Record<string, string | number> = {}): string =>
        translate(`longtail:events.guildNotice.${key}`, language, variables);
    const embed = new EmbedBuilder()
        .setColor(joined ? client.config.color.green : client.config.color.red)
        .setAuthor({
            name: guild.name || copy('unknownGuild'),
            iconURL: guild.iconURL({ extension: 'jpeg' }) ?? undefined,
        })
        .setDescription(
            copy(joined ? 'addedDescription' : 'removedDescription', {
                name: guild.name || copy('unknownGuild'),
            })
        )
        .setThumbnail(guild.iconURL({ extension: 'jpeg' }))
        .addFields(
            { name: copy('owner'), value: owner?.user.tag ?? copy('unknown'), inline: true },
            {
                name: copy('members'),
                value: guild.memberCount?.toString() ?? copy('unknown'),
                inline: true,
            },
            {
                name: copy('createdAt'),
                value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                inline: true,
            },
            {
                name: copy(joined ? 'joinedAt' : 'removedAt'),
                value: `<t:${Math.floor(timestamp / 1000)}:F>`,
                inline: true,
            },
            { name: copy('id'), value: guild.id, inline: true }
        )
        .setTimestamp();

    const channel = await client.channels.fetch(client.config.logChannelId).catch(() => null);
    if (!(channel instanceof TextChannel)) return;
    return await channel.send({ embeds: [embed] });
}
