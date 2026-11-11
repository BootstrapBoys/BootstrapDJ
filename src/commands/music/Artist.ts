import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class Artist extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'artist',
            description: {
                content: 'Looks up an artist or queues their top result',
                usage: 'artist <name>',
                examples: ['artist NF'],
            },
            category: 'music',
            aliases: ['artistsearch', 'artistinfo'],
            cooldown: 3,
            args: true,
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
                    name: 'name',
                    description: 'Artist name',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const query = args.join(' ').trim();
        if (!query) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.artistNoName')),
                ],
            });
        }
        const res = await client.queue.search(query, await resolveSearchEngine(client, ctx));
        const track = client.utils.firstTrack(res);
        if (!track) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.artistNoResults', { query })),
                ],
            });
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(track.info.author)
                    .setDescription(
                        tr(ctx, 'longtail:music.artistTopResult', {
                            title: track.info.title,
                            uri: track.info.uri ?? '',
                            duration: track.info.isStream
                                ? tr(ctx, 'longtail:music.live')
                                : client.utils.formatTime(track.info.length),
                            source: track.info.sourceName,
                        })
                    ),
            ],
        });
    }
}
