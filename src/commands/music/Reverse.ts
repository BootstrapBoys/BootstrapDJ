import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Reverse extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'reverse',
            description: {
                content: 'Reverses the queued tracks',
                usage: 'reverse',
                examples: ['reverse'],
            },
            category: 'music',
            aliases: ['rev'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: true, active: true, djPerm: null },
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
        if (!player?.current || !player.queue.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.reverse.empty')),
                ],
            });
        }
        player.queue.reverse();
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        tr(
                            ctx,
                            player.queue.length === 1
                                ? 'longtail:music.reverse.reversedOne'
                                : 'longtail:music.reverse.reversedMany',
                            { count: player.queue.length }
                        )
                    ),
            ],
        });
    }
}
