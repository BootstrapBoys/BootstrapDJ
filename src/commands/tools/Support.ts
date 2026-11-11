import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Support extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'support',
            description: {
                content: 'How to get help with BootstrapDJ',
                usage: 'support',
                examples: ['support'],
            },
            category: 'info',
            aliases: ['helpme'],
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
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:tools.supportTitle'))
                    .setDescription(
                        [
                            tr(ctx, 'longtail:tools.supportHelp'),
                            '',
                            tr(ctx, 'longtail:tools.supportIssues'),
                            'https://github.com/BootstrapBoys/BootstrapDJ/issues',
                            '',
                            tr(ctx, 'longtail:tools.supportNoTier'),
                        ].join('\n')
                    ),
            ],
        });
    }
}
