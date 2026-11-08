import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

const NAME_LIMIT = 50;

export default class Create extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'create',
            description: {
                content: 'Creates a playlist',
                examples: ['create <name>'],
                usage: 'create <name>',
            },
            category: 'playlist',
            aliases: ['create'],
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
                    name: 'name',
                    description: 'The name of the playlist',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({ embeds: [{ description: text, color: client.color.red }] });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const name = args.join(' ').trim();

        if (name.length > NAME_LIMIT) {
            return await this.fail(client, ctx, 'Playlist names can only be 50 characters long');
        }
        if (await client.db.getPLaylist(author.id, name)) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'A playlist with that name already exists',
                        color: client.color.main,
                    },
                ],
            });
        }

        await client.db.createPlaylist(author.id, name);
        return await ctx.sendMessage({
            embeds: [
                { description: `Playlist **${name}** has been created`, color: client.color.main },
            ],
        });
    }
}
