import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

const TIP_KEYS = [
    'tipPlayNext',
    'tipAutoplay',
    'tipQueue',
    'tipFilters',
    'tipRecentlyPlayed',
    'tipPlayRecent',
    'tipSort',
    'tipRemoveAbsent',
];

export default class Tip extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'tip',
            description: {
                content: 'Shows a random BootstrapDJ tip',
                usage: 'tip',
                examples: ['tip'],
            },
            category: 'info',
            aliases: ['tips'],
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
        const tip = tr(
            ctx,
            `longtail:tools.${TIP_KEYS[Math.floor(Math.random() * TIP_KEYS.length)]}`
        );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:tools.tipTitle'))
                    .setDescription(tip),
            ],
        });
    }
}
