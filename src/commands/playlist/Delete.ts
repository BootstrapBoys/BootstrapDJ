import { ApplicationCommandOptionType } from 'discord.js';

import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Delete extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: 'delete',
            description: {
                content: 'Deletes a playlist',
                examples: ['delete <playlist name>'],
                usage: 'delete <playlist name>',
            },
            category: 'playlist',
            aliases: ['delete'],
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
                    description: 'The playlist you want to delete',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true,
                },
            ],
        });
    }
    public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
        const playlist = args.join(' ').trim();

        const playlistExists = await client.db.getPLaylist(ctx.author.id, playlist);
        if (!playlistExists)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'That playlist doesn\'t exist',
                        color: client.color.red,
                    },
                ],
            });

        const songs = await client.db.getSong(ctx.author.id, playlist);
        const deleted = await client.db.deletePlaylist(ctx.author.id, playlist);
        if (!deleted)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: `Could not delete playlist **${playlist}**`,
                        color: client.color.red,
                    },
                ],
            });
        return await ctx.sendMessage({
            embeds: [
                {
                    description: `Deleted playlist **${playlist}** and its ${songs.length} song${
                        songs.length === 1 ? '' : 's'
                    }`,
                    color: client.color.main,
                },
            ],
        });
    }
}
