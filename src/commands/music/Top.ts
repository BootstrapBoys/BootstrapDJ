import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class Top extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'top',
            description: {
                content: 'Shows top search results for a query',
                usage: 'top [query]',
                examples: ['top', 'top NF'],
            },
            category: 'music',
            aliases: ['topsongs', 'topresults'],
            cooldown: 3,
            args: false,
            defer: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'query',
                    description: 'Search query; defaults to top hits',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const query = args.join(' ').trim() || 'top hits';
        const res = await client.queue.search(query, await resolveSearchEngine(client, ctx));
        if (!res || res.loadType !== LoadType.SEARCH) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.topNoResults', { query })),
                ],
            });
        }
        const lines = res.data
            .slice(0, 10)
            .map(
                (track, index) =>
                    `**${index + 1}.** [${track.info.title}](${track.info.uri}) — ${track.info.author}`
            );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:music.topTitle', { query }))
                    .setDescription(lines.join('\n') || tr(ctx, 'longtail:music.topEmpty')),
            ],
        });
    }
}
