import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Filters extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'filters',
            description: {
                content: 'Shows active audio filters',
                usage: 'filters',
                examples: ['filters'],
            },
            category: 'filters',
            aliases: ['activefilters'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: false, active: true, djPerm: null },
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
                        .setDescription(tr(ctx, 'longtail:filters.nothingPlaying')),
                ],
            });
        }
        const filters = player.filters.length
            ? player.filters.join(', ')
            : tr(ctx, 'longtail:filters.none');
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:filters.activeTitle'))
                    .setDescription(filters),
            ],
        });
    }
}
