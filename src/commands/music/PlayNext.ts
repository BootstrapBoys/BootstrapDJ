import { LoadType } from 'shoukaku';

import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class PlayNext extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: 'playnext',
            description: {
                content: 'Add the song to play next in queue',
                examples: [
                    'playnext https://www.youtube.com/watch?v=QH2-TGUlwu4',
                    'playnext https://open.spotify.com/track/6WrI0LAC5M1Rw2MnX2ZvEg',
                ],
                usage: 'playnext <song>',
            },
            category: 'music',
            aliases: ['pn'],
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
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks', 'Connect', 'Speak'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'song',
                    description: 'The song you want to play',
                    type: 3,
                    required: true,
                    autocomplete: true,
                },
            ],
        });
    }
    public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
        const query = args.join(' ');
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        let player = client.queue.get(guild.id);
        const vc = ctx.voiceChannel;
        if (!player) player = await client.queue.create(guild, vc, ctx.channel);

        const res = await this.client.queue.search(query);
        const embed = this.client.embed();
        if (!res)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('There was an error while searching. Please try again.'),
                ],
            });
        switch (res.loadType) {
            case LoadType.ERROR:
                ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.red)
                            .setDescription('There was an error while searching.'),
                    ],
                });
                break;
            case LoadType.EMPTY:
                ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.red)
                            .setDescription('There were no results found.'),
                    ],
                });
                break;
            case LoadType.TRACK: {
                const track = player.buildTrack(res.data, author);
                if (player.queue.length > client.config.maxQueueSize)
                    return await ctx.sendMessage({
                        embeds: [
                            embed
                                .setColor(this.client.color.red)
                                .setDescription(
                                    `The queue is too long. The maximum length is ${client.config.maxQueueSize} songs.`
                                ),
                        ],
                    });
                player.enqueueNext(track);
                await player.isPlaying();
                ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.main)
                            .setDescription(
                                `Added [${res.data.info.title}](${res.data.info.uri}) to play next in the queue.`
                            ),
                    ],
                });
                break;
            }
            case LoadType.PLAYLIST: {
                if (res.data.tracks.length > client.config.maxPlaylistSize)
                    return await ctx.sendMessage({
                        embeds: [
                            embed
                                .setColor(this.client.color.red)
                                .setDescription(
                                    `The playlist is too long. The maximum length is ${client.config.maxPlaylistSize} songs.`
                                ),
                        ],
                    });
                for (const track of res.data.tracks) {
                    const pl = player.buildTrack(track, author);
                    if (player.queue.length > client.config.maxQueueSize)
                        return await ctx.sendMessage({
                            embeds: [
                                embed
                                    .setColor(this.client.color.red)
                                    .setDescription(
                                        `The queue is too long. The maximum length is ${client.config.maxQueueSize} songs.`
                                    ),
                            ],
                        });
                    player.enqueueNext(pl);
                }
                await player.isPlaying();
                ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.main)
                            .setDescription(
                                `Added ${res.data.tracks.length} songs to play next in the queue.`
                            ),
                    ],
                });
                break;
            }
            case LoadType.SEARCH: {
                const track1 = player.buildTrack(res.data[0], author);
                if (player.queue.length > client.config.maxQueueSize)
                    return await ctx.sendMessage({
                        embeds: [
                            embed
                                .setColor(this.client.color.red)
                                .setDescription(
                                    `The queue is too long. The maximum length is ${client.config.maxQueueSize} songs.`
                                ),
                        ],
                    });
                player.enqueueNext(track1);
                await player.isPlaying();
                ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.main)
                            .setDescription(
                                `Added [${res.data[0].info.title}](${res.data[0].info.uri}) to play next in the queue.`
                            ),
                    ],
                });
                break;
            }
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
