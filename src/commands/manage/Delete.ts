import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Delete extends Command {
    constructor(client: BootstrapClient) {
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
            slashCommand: false,
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
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const playlist = args.join(' ').trim();

        const playlistExists = await client.db.getPLaylist(author.id, playlist);
        if (!playlistExists)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'That playlist doesn\'t exist',
                        color: client.color.red,
                    },
                ],
            });

        const songs = await client.db.getSong(author.id, playlist);
        const deleted = await client.db.deletePlaylist(author.id, playlist);
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
