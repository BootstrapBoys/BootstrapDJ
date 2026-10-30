import { EmbedBuilder } from 'discord.js';

import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Queue extends Command {
    constructor(client: Lavamusic) {
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
            options: [],
        });
    }
    public async run(client: Lavamusic, ctx: Context): Promise<any> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
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
