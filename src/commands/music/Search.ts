import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { LoadType } from 'shoukaku';

import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Search extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: 'search',
            description: {
                content: 'Searches for a song',
                examples: ['search', 'search <song>'],
                usage: 'search',
            },
            category: 'music',
            aliases: ['search'],
            cooldown: 3,
            args: true,
            player: {
                voice: true,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'song',
                    description: 'The song you want to search',
                    type: 3,
                    required: true,
                },
            ],
        });
    }
    public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
        const embed = client.embed().setColor(client.color.main);
        const query = args.join(' ');

        if (!client.queue.hasNode)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription(
                            'No Lavalink node is available right now. Please try again in a moment.'
                        ),
                ],
            });

        let player = client.queue.get(ctx.guild.id);
        if (!player) {
            const vc = ctx.member as any;
            player = await client.queue.create(ctx.guild, vc.voice.channel, ctx.channel);
        }

        const res = await this.client.queue.search(query);
        if (!res)
            return await ctx.sendMessage({
                embeds: [embed.setColor(client.color.red).setDescription('**No results found**')],
            });

        switch (res.loadType) {
            case LoadType.ERROR:
                return await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(client.color.red)
                            .setDescription('There was an error while searching.'),
                    ],
                });
            case LoadType.EMPTY:
                return await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(client.color.red)
                            .setDescription('There were no results found.'),
                    ],
                });
            case LoadType.TRACK: {
                player.queue.push(player.buildTrack(res.data, ctx.author));
                await player.isPlaying();
                return await ctx.sendMessage({
                    embeds: [
                        embed.setDescription(
                            `Added [${res.data.info.title}](${res.data.info.uri}) to the queue`
                        ),
                    ],
                });
            }
            case LoadType.PLAYLIST: {
                for (const track of res.data.tracks)
                    player.queue.push(player.buildTrack(track, ctx.author));
                await player.isPlaying();
                return await ctx.sendMessage({
                    embeds: [
                        embed.setDescription(`Added ${res.data.tracks.length} songs to the queue`),
                    ],
                });
            }
        }

        // Only SEARCH reaches here; every other load type returned above, so the
        // collector is bound to the picker message instead of the whole channel.
        const tracks = res.data.slice(0, 5);
        if (!tracks.length)
            return await ctx.sendMessage({
                embeds: [
                    embed.setColor(client.color.red).setDescription('There were no results found.'),
                ],
            });

        const list = tracks
            .map(
                (track: any, index: number) =>
                    `${index + 1}. [${track.info.title}](${track.info.uri}) - \`${
                        track.info.author
                    }\``
            )
            .join('\n');
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            tracks.map((_track: any, index: number) =>
                new ButtonBuilder()
                    .setCustomId(`search:${index}`)
                    .setLabel(`${index + 1}`)
                    .setStyle(ButtonStyle.Primary)
            )
        );

        const msg = await ctx.sendMessage({
            embeds: [embed.setDescription(list)],
            components: [row],
        });

        const collector = msg.createMessageComponentCollector({
            filter: (int: any) => int.user.id === ctx.author.id,
            max: 1,
            time: 60000,
        });

        collector.on('collect', async (int: any) => {
            const index = Number(int.customId.split(':')[1]);
            const picked = tracks[index];
            await int.deferUpdate();
            if (!picked) return;
            const song = player.buildTrack(picked, ctx.author);
            player.queue.push(song);
            await player.isPlaying();
            await msg
                .edit({
                    embeds: [
                        embed.setDescription(
                            `Added [${song.info.title}](${song.info.uri}) to the queue`
                        ),
                    ],
                    components: [],
                })
                .catch(() => {});
            collector.stop();
        });

        collector.on('end', async (_collected: any, reason: string) => {
            if (reason === 'time') await msg.edit({ components: [] }).catch(() => {});
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
