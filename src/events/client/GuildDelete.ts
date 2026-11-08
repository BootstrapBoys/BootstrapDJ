import { EmbedBuilder, Guild, TextChannel } from 'discord.js';

import { BootstrapClient, Event } from '../../core/index.js';
import { stopSetupJanitor } from '../../lib/SetupSystem.js';

export default class GuildDelete extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'guildDelete',
        });
    }
    public async run(guild: Guild): Promise<unknown> {
        const dispatcher = this.client.queue.get(guild.id);
        dispatcher?.destroy();
        void this.client.db.deleteSession(guild.id).catch(() => {});
        if (this.client.user) {
            void this.client.db.releaseSessionLease(guild.id, this.client.user.id).catch(() => {});
        }
        stopSetupJanitor(guild.id);
        const owner = await guild.fetchOwner().catch(() => null);
        const embed = new EmbedBuilder()
            .setColor(this.client.config.color.red)
            .setAuthor({
                name: guild.name || 'Unknown Guild',
                iconURL: guild.iconURL({ extension: 'jpeg' }) ?? undefined,
            })

            .setDescription(`**${guild.name}** has been removed from my guilds!`)
            .setThumbnail(guild.iconURL({ extension: 'jpeg' }))
            .addFields(
                { name: 'Owner', value: owner?.user.tag ?? 'Unknown', inline: true },
                {
                    name: 'Members',
                    value: guild.memberCount ? guild.memberCount.toString() : 'Unknown',
                    inline: true,
                },
                {
                    name: 'Created At',
                    value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                    inline: true,
                },
                {
                    name: 'Removed At',
                    value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
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
