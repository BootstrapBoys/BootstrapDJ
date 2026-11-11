import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Faq extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'faq',
            description: {
                content: 'Common BootstrapDJ usage questions',
                usage: 'faq',
                examples: ['faq'],
            },
            category: 'info',
            aliases: ['howtouse'],
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
                    .setTitle(tr(ctx, 'longtail:tools.faqTitle'))
                    .setDescription(
                        [
                            tr(ctx, 'longtail:tools.faqQ1'),
                            tr(ctx, 'longtail:tools.faqA1'),
                            '',
                            tr(ctx, 'longtail:tools.faqQ2'),
                            tr(ctx, 'longtail:tools.faqA2'),
                            '',
                            tr(ctx, 'longtail:tools.faqQ3'),
                            tr(ctx, 'longtail:tools.faqA3'),
                            '',
                            tr(ctx, 'longtail:tools.faqQ4'),
                            tr(ctx, 'longtail:tools.faqA4'),
                            '',
                            tr(ctx, 'longtail:tools.faqQ5'),
                            tr(ctx, 'longtail:tools.faqA5'),
                        ].join('\n')
                    ),
            ],
        });
    }
}
