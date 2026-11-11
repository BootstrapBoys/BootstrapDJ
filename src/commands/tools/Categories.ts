import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Categories extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'categories',
            description: {
                content: 'Lists all command categories',
                usage: 'categories',
                examples: ['categories'],
            },
            category: 'info',
            aliases: ['category'],
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
        const counts = new Map<string, number>();
        for (const command of client.commands.values()) {
            if (!command.category || command.category === 'dev') continue;
            counts.set(command.category, (counts.get(command.category) ?? 0) + 1);
        }
        const lines = [...counts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, count]) =>
                tr(ctx, `longtail:tools.${count === 1 ? 'categoryLineOne' : 'categoryLineMany'}`, {
                    category,
                    count,
                })
            );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:tools.categoriesTitle'))
                    .setDescription(lines.join('\n') || tr(ctx, 'longtail:tools.noCategories')),
            ],
        });
    }
}
