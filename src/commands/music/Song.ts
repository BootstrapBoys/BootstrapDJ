import { ApplicationCommandOptionType } from 'discord.js';
import { Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class Song extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'song',
            description: { content: 'Shows information about the current or searched song', usage: 'song [query]', examples: ['song', 'song The Search NF'] },
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
                    embeds: [client.embed().setColor(client.color.red).setDescription('No Lavalink node is available.')],
                });
            }
            track = client.utils.firstTrack(await client.queue.search(query, await resolveSearchEngine(client, ctx)));
        }
        if (!track) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(query ? `No results for **${query}**.` : 'Nothing is playing right now.'),
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
                            `**Artist:** ${track.info.author}`,
                            `**Duration:** ${track.info.isStream ? 'LIVE' : client.utils.formatTime(track.info.length)}`,
                            `**Source:** ${track.info.sourceName}`,
                            track.info.uri ? `**URL:** ${track.info.uri}` : '',
                        ]
                            .filter(Boolean)
                            .join('\n')
                    ),
            ],
        });
    }
}
