import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Premium extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'premium',
            description: {
                content: 'Explains the free feature policy',
                usage: 'premium',
                examples: ['premium'],
            },
            category: 'info',
            aliases: ['perks'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setTitle(tr(ctx, 'longtail:tools.premiumTitle'))
                    .setDescription(tr(ctx, 'longtail:tools.premiumDescription')),
            ],
        });
    }
}
