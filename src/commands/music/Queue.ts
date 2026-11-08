import { EmbedBuilder } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Queue extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'queue',
            description: {
                content: 'Shows the current queue',
                examples: ['queue'],
                usage: 'queue',
            },
            category: 'music',
            aliases: ['q'],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: false,
                active: true,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            ephemeral: false,
            options: [],
        });
    }
    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player)
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.red)
                        .setDescription('There is no music playing in this server.'),
                ],
            });
        const current = player.current;
        if (player.queue.length === 0) {
            if (!current)
                return await ctx.sendMessage({
                    embeds: [
                        this.client
                            .embed()
                            .setColor(this.client.color.red)
                            .setDescription(`Nothing playing right now`),
                    ],
                });
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.main)
                        .setDescription(
                            `Now playing: [${current.info.title}](${
                                current.info.uri
                            }) - Request By: ${current.info.requester} - Duration: ${
                                current.info.isStream
                                    ? 'LIVE'
                                    : this.client.utils.formatTime(current.info.length)
                            }`
                        )
                        .addFields(
                            { name: 'Queued tracks', value: '0', inline: true },
                            { name: 'Queue length', value: '0:00', inline: true },
                            { name: 'Autoplay', value: player.autoplay ? 'on' : 'off', inline: true },
                            { name: 'Loop', value: player.loop, inline: true }
                        ),
                ],
            });
        }
        const queue = player.queue.map(
            (track, index) =>
                `${index + 1}. [${track.info.title}](${track.info.uri}) - Request By: ${
                    track?.info.requester
                } - Duration: ${
                    track.info.isStream ? 'LIVE' : this.client.utils.formatTime(track.info.length)
                }`
        );
        const total = player.queue.reduce((sum, track) => sum + (track.info.length || 0), 0);
        const chunks = client.utils.chunk(queue, 10);
        if (chunks.length === 0) chunks.push([]);
        const pages: EmbedBuilder[] = [];
        for (let i = 0; i < chunks.length; i++) {
            const embed = this.client
                .embed()
                .setColor(this.client.color.main)
                .setAuthor({ name: 'Queue', iconURL: guild.iconURL({}) ?? undefined })
                .setDescription(chunks[i].join('\n'))
                .setFooter({ text: `Page ${i + 1} of ${chunks.length}` });
            if (i === 0) {
                embed.addFields(
                    { name: 'Queued tracks', value: String(player.queue.length), inline: true },
                    { name: 'Queue length', value: client.utils.formatTime(total), inline: true },
                    { name: 'Autoplay', value: player.autoplay ? 'on' : 'off', inline: true },
                    { name: 'Loop', value: player.loop, inline: true }
                );
            }
            pages.push(embed);
        }

        return await client.utils.paginate(ctx, pages);
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
