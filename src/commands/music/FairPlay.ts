import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class FairPlay extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'fairplay',
            description: {
                content: 'Round-robins the queue by requester',
                examples: ['fairplay'],
                usage: 'fairplay',
            },
            category: 'music',
            aliases: ['fp'],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: true,
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

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('Nothing is playing right now.'),
                ],
            });
        }
        if (!player.queue.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('There are no queued tracks to rebalance.'),
                ],
            });
        }

        const count = player.fairPlay();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        `Queue rebalanced fairly across requesters (${count} track${count === 1 ? '' : 's'}).`
                    ),
            ],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
