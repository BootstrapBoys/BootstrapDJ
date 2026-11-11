import { ApplicationCommandOptionType } from 'discord.js';
import { Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class Song extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'song',
            description: {
                content: 'Shows information about the current or searched song',
                usage: 'song [query]',
                examples: ['song', 'song The Search NF'],
            },
            category: 'music',
            aliases: ['songinfo'],
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
                    description: 'Song to look up; defaults to the current track',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const query = args.join(' ').trim();
        let track: Track | null = client.queue.get(guild.id)?.current ?? null;
        if (query) {
            if (!client.queue.hasNode) {
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription(tr(ctx, 'longtail:music.songNoNode')),
                    ],
                });
            }
            track = client.utils.firstTrack(
                await client.queue.search(query, await resolveSearchEngine(client, ctx))
            );
        }
        if (!track) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(
                            query
                                ? tr(ctx, 'longtail:music.songNoResults', { query })
                                : tr(ctx, 'longtail:music.songNothingPlaying')
                        ),
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
                        [
                            tr(ctx, 'longtail:music.songArtist', { artist: track.info.author }),
                            tr(ctx, 'longtail:music.songDuration', {
                                duration: track.info.isStream
                                    ? 'LIVE'
                                    : client.utils.formatTime(track.info.length),
                            }),
                            tr(ctx, 'longtail:music.songSource', { source: track.info.sourceName }),
                            track.info.uri
                                ? tr(ctx, 'longtail:music.songUrl', { uri: track.info.uri })
                                : '',
                        ]
                            .filter(Boolean)
                            .join('\n')
                    ),
            ],
        });
    }
}
