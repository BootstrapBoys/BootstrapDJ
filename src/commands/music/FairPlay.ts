import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

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
                        .setDescription(tr(ctx, 'longtail:music.nothingPlaying')),
                ],
            });
        }
        if (!player.queue.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.fairPlayEmptyQueue')),
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
                        tr(
                            ctx,
                            count === 1
                                ? 'longtail:music.fairPlayRebalancedOne'
                                : 'longtail:music.fairPlayRebalancedMany',
                            { count }
                        )
                    ),
            ],
        });
    }
}
