import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class Album extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'album',
            description: {
                content: 'Looks up an album or queues its first result',
                usage: 'album <name>',
                examples: ['album The Search'],
            },
            category: 'music',
            aliases: ['albumsearch', 'albuminfo'],
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
                    description: 'Album name',
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
                        .setDescription(tr(ctx, 'longtail:music.albumNoName')),
                ],
            });
        }
        const res = await client.queue.search(
            `album ${query}`,
            await resolveSearchEngine(client, ctx)
        );
        const track = client.utils.firstTrack(res);
        if (!track) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.albumNoResults', { query })),
                ],
            });
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(track.info.title)
                    .setURL(track.info.uri ?? null)
                    .setDescription(
                        tr(ctx, 'longtail:music.albumTrackInfo', {
                            artist: track.info.author,
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
