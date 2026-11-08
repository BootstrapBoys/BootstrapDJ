import { ApplicationCommandOptionType } from 'discord.js';
import { Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class RemoveSong extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'removesong',
            description: {
                content: 'Removes a song from a playlist',
                examples: ['removesong <playlist> <song>'],
                usage: 'removesong <playlist> <song>',
            },
            category: 'playlist',
            aliases: ['rs'],
            cooldown: 3,
            args: true,
            player: {
                voice: false,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            defer: true,
            options: [
                {
                    name: 'playlist',
                    description: 'The playlist to edit',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true,
                },
                {
                    name: 'song',
                    description: 'The song to remove',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const playlist = args[0]?.trim();
        const query = args.slice(1).join(' ').trim();
        const embed = client.embed().setColor(client.color.main);

        if (!playlist || !query) {
            return await ctx.sendMessage({
                embeds: [embed.setColor(client.color.red).setDescription('Provide a playlist and a song.')],
            });
        }

        const playlistData = await client.db.getPLaylist(author.id, playlist);
        if (!playlistData) {
            return await ctx.sendMessage({
                embeds: [embed.setColor(client.color.red).setDescription('That playlist doesn\'t exist.')],
            });
        }

        if (!client.queue.hasNode) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription('No Lavalink node is available right now.'),
                ],
            });
        }

        const track: Track | null = client.utils.firstTrack(await client.queue.search(query, await resolveSearchEngine(client, ctx)));
        if (!track) {
            return await ctx.sendMessage({
                embeds: [embed.setColor(client.color.red).setDescription(`No results found for **${query}**.`)],
            });
        }

        const key =
            track.info.uri ??
            (track.info.identifier && track.info.sourceName
                ? `${track.info.sourceName}:${track.info.identifier}`
                : track.encoded);
        const removed = await client.db.removeSong(author.id, playlist, key);
        if (!removed) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription(
                            `[${track.info.title}](${track.info.uri}) is not in **${playlistData.name}**.`
                        ),
                ],
            });
        }

        return await ctx.sendMessage({
            embeds: [
                embed.setDescription(
                    `Removed [${track.info.title}](${track.info.uri}) from **${playlistData.name}**.`
                ),
            ],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
