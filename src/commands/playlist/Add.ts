import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType } from 'shoukaku';

import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Add extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: 'add',
            description: {
                content: 'Adds a song to the playlist',
                examples: ['add <playlist> <song>'],
                usage: 'add <playlist> <song>',
            },
            category: 'playlist',
            aliases: ['add'],
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
            slashCommand: true,
            options: [
                {
                    name: 'playlist',
                    description: 'The playlist you want to add',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true,
                },
                {
                    name: 'song',
                    description: 'The song you want to add',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }
    public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
        const playlist = args[0];
        const song = args[1];

        if (!playlist)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'Please provide a playlist',
                        color: client.color.red,
                    },
                ],
            });

        if (!song)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'Please provide a song',
                        color: client.color.red,
                    },
                ],
            });

        const playlistData = await client.db.getPLaylist(ctx.author.id, playlist);

        if (!playlistData)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'That playlist doesn\'t exist',
                        color: client.color.red,
                    },
                ],
            });

        const res = await client.queue.search(song);
        if (!res)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'No songs found',
                        color: client.color.red,
                    },
                ],
            });

        // Normalise every load type to an array of tracks; res.data is a single
        // track for TRACK, an array for SEARCH, and { tracks } for PLAYLIST.
        let tracks: any[] = [];
        if (res.loadType === LoadType.PLAYLIST) tracks = res.data.tracks;
        else if (res.loadType === LoadType.TRACK) tracks = [res.data];
        else if (res.loadType === LoadType.SEARCH && res.data.length) tracks = [res.data[0]];

        if (!tracks.length)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'No songs found',
                        color: client.color.red,
                    },
                ],
            });

        let added = 0;
        let duplicates = 0;
        for (const track of tracks) {
            const created = await client.db.addSong(ctx.author.id, playlist, track);
            if (created) added++;
            else duplicates++;
        }

        await ctx.sendMessage({
            embeds: [
                {
                    description: `Added ${added} to ${playlistData.name}${
                        duplicates ? ` (${duplicates} already in the playlist)` : ''
                    }`,
                    color: client.color.green,
                },
            ],
        });
    }
}
