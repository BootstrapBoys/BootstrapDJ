import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Delete extends Command {
    public constructor(client: BootstrapClient) {
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
            player: { voice: false, dj: false, active: false, djPerm: null },
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
        const name = args.join(' ').trim();
        const embed = client.embed();

        if (!(await client.db.getPLaylist(author.id, name))) {
            return await ctx.sendMessage({
                embeds: [embed.setColor(client.color.red).setDescription('That playlist doesn\'t exist')],
            });
        }

        const songs = await client.db.getSong(author.id, name);
        if (!(await client.db.deletePlaylist(author.id, name))) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription(`Could not delete playlist **${name}**`),
                ],
            });
        }

        return await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(client.color.main)
                    .setDescription(
                        `Deleted playlist **${name}** and its ${songs.length} song${songs.length === 1 ? '' : 's'}`
                    ),
            ],
        });
    }
}
