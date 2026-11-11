import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

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

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:manage.delete.${key}`, variables);
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const name = args.join(' ').trim();
        const embed = client.embed();

        if (!(await client.db.getPLaylist(author.id, name))) {
            return await ctx.sendMessage({
                embeds: [
                    embed.setColor(client.color.red).setDescription(this.copy(ctx, 'notExist')),
                ],
            });
        }

        const songs = await client.db.getSong(author.id, name);
        if (!(await client.db.deletePlaylist(author.id, name))) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription(this.copy(ctx, 'failed', { name })),
                ],
            });
        }

        return await ctx.sendMessage({
            embeds: [
                embed.setColor(client.color.main).setDescription(
                    this.copy(ctx, songs.length === 1 ? 'deleted' : 'deletedPlural', {
                        name,
                        count: songs.length,
                    })
                ),
            ],
        });
    }
}
