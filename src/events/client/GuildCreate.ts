import { EmbedBuilder, Guild, TextChannel } from 'discord.js';

import { BootstrapClient, Event } from '../../core/index.js';

export default class GuildCreate extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'guildCreate',
        });
    }
    public async run(guild: Guild): Promise<unknown> {
        const owner = await guild.fetchOwner().catch(() => null);
        const embed = new EmbedBuilder()
            .setColor(this.client.config.color.green)
            .setAuthor({ name: guild.name, iconURL: guild.iconURL({ extension: 'jpeg' }) ?? undefined })
            .setDescription(`**${guild.name}** has been added to my guilds!`)
            .setThumbnail(guild.iconURL({ extension: 'jpeg' }) ?? null)
            .addFields(
                { name: 'Owner', value: owner?.user.tag ?? 'Unknown', inline: true },
                { name: 'Members', value: guild.memberCount.toString(), inline: true },
                {
                    name: 'Created At',
                    value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                    inline: true,
                },
                {
                    name: 'Joined At',
                    value: `<t:${Math.floor(guild.joinedTimestamp / 1000)}:F>`,
                    inline: true,
                },
                { name: 'ID', value: guild.id, inline: true }
            )
            .setTimestamp();
        if (!this.client.config.logChannelId) return;
        const channel = (await this.client.channels
            .fetch(this.client.config.logChannelId)
            .catch(() => null)) as TextChannel | null;
        if (!channel) return;
        return await channel.send({ embeds: [embed] });
    }
}
