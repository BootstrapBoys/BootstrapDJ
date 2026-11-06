import { LoadType } from 'shoukaku';

import { BootstrapClient, Command, Context, Song } from '../../structures/index.js';
import { checkTrack, getPlayLimits } from '../../utils/PlayLimits.js';

export default class PlayNext extends Command {
    constructor(client: BootstrapClient) {
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
                let playlistDuration = 0;
                const accepted: Song[] = [];
                for (const track of res.data.tracks.slice(0, limits.maxPlaylistTracks || undefined)) {
                    const trackLength = track.info.isStream ? 0 : track.info.length;
                    if (limits.maxPlaylistLength > 0 && playlistDuration + trackLength > limits.maxPlaylistLength * 1000) break;
                    playlistDuration += trackLength;
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
                    accepted.push(pl);
                }
                // enqueueNext unshifts; reverse the batch so the playlist keeps
                // its original order at the front of the queue.
                for (let index = accepted.length - 1; index >= 0; index--) {
                    player.enqueueNext(accepted[index], true, false);
                }
                void player.persist();
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
                const first = res.data[0];
                if (!first) {
                    return await ctx.sendMessage({
                        embeds: [embed.setColor(client.color.red).setDescription('There were no results found.')],
                    });
                }
                const track1 = player.buildTrack(first, author);
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
                player.enqueueNext(track1);
                await player.isPlaying();
                ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.main)
                            .setDescription(
                                `Added [${first.info.title}](${first.info.uri}) to play next in the queue.`
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
