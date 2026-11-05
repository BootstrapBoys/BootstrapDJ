import { LoadType } from 'shoukaku';

import { BootstrapClient, Command, Context, Song } from '../../structures/index.js';
import { checkTrack, getPlayLimits } from '../../utils/PlayLimits.js';

export default class Play extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'play',
            description: {
                content: 'Plays a song from YouTube or Spotify',
                examples: [
                    'play https://www.youtube.com/watch?v=QH2-TGUlwu4',
                    'play https://open.spotify.com/track/6WrI0LAC5M1Rw2MnX2ZvEg',
                ],
                usage: 'play <song>',
            },
            category: 'music',
            aliases: ['p'],
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
            defer: true,
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
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const query = args.join(' ');
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        let player = client.queue.get(guild.id);
        const vc = ctx.voiceChannel;
        if (!client.queue.hasNode)
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.red)
                        .setDescription(
                            'No Lavalink node is available right now. Please try again in a moment.'
                        ),
                ],
            });
        if (!player || player.isStale) player = await client.queue.create(guild, vc, ctx.channel);
        const limits = await getPlayLimits(client, guild.id);
        const guildSettings: Record<string, string> = await client.db.getGuildSettings(guild.id).catch(() => ({}));
        const searchEngine = guildSettings.searchtype || client.config.searchEngine;

        const res = await this.client.queue.search(query, searchEngine);
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
            case LoadType.ERROR: {
                const exception = res.data as {
                    message?: string;
                    severity?: string;
                    cause?: string;
                };
                const detail = exception?.cause || exception?.message || 'unknown';
                this.client.logger.error(`Lavalink load error for ${query}: ${detail}`);
                await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.red)
                            .setDescription(
                                `There was an error while searching.\n\`${detail.slice(0, 200)}\``
                            ),
                    ],
                });
                break;
            }
            case LoadType.EMPTY:
                await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.red)
                            .setDescription('There were no results found.'),
                    ],
                });
                break;
            case LoadType.TRACK: {
                const track = player.buildTrack(res.data, author);
                const rejected = checkTrack(player, track, author.id, limits);
                if (rejected)
                    return await ctx.sendMessage({
                        embeds: [embed.setColor(client.color.red).setDescription(rejected)],
                    });
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
                player.enqueue(track);
                await player.isPlaying();
                await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.main)
                            .setDescription(
                                `Added [${res.data.info.title}](${res.data.info.uri}) to the queue.`
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
                const added: Song[] = [];
                for (const track of res.data.tracks.slice(0, limits.maxPlaylistTracks || undefined)) {
                    const pl = player.buildTrack(track, author);
                    const rejected = checkTrack(player, pl, author.id, limits);
                    if (rejected) continue;
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
                    player.enqueue(pl, false);
                    added.push(pl);
                }
                player.seedPlaylist(added);
                await player.isPlaying();
                await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.main)
                            .setDescription(`Added ${res.data.tracks.length} songs to the queue.`),
                    ],
                });
                break;
            }
            case LoadType.SEARCH: {
                const track1 = player.buildTrack(res.data[0], author);
                const rejected = checkTrack(player, track1, author.id, limits);
                if (rejected)
                    return await ctx.sendMessage({
                        embeds: [embed.setColor(client.color.red).setDescription(rejected)],
                    });
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
                player.enqueue(track1);
                await player.isPlaying();
                await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.main)
                            .setDescription(
                                `Added [${res.data[0].info.title}](${res.data[0].info.uri}) to the queue.`
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
