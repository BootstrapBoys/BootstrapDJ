import { ApplicationCommandOptionType, User } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class List extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'list',
            description: {
                content: 'Lists playlists',
                examples: ['list', 'list @user'],
                usage: 'list [user]',
            },
            category: 'playlist',
            aliases: ['playlists', 'pls'],
            cooldown: 3,
            args: false,
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
                    name: 'user',
                    description: 'Whose playlists to show',
                    type: ApplicationCommandOptionType.User,
                    required: false,
                },
            ],
        });
    }

    private async resolveUser(client: BootstrapClient, ctx: Context): Promise<User | null> {
        if (ctx.isInteraction) {
            return ctx.interaction?.options.getUser('user') ?? ctx.author;
        }
        const argument = ctx.args[0];
        if (!argument) return ctx.author;
        const id = String(argument).replace(/[<@!>]/g, '');
        return await client.users.fetch(id).catch(() => null);
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const target = await this.resolveUser(client, ctx);
        if (!target) return;

        const playlists = await client.db.getPlaylists(target.id);
        const embed = client.embed().setColor(client.color.main);
        if (!playlists.length) {
            return await ctx.sendMessage({
                embeds: [
                    embed.setDescription(
                        target.id === ctx.author?.id
                            ? 'You don\'t have any playlists.'
                            : `${target.username} doesn't have any playlists.`
                    ),
                ],
            });
        }

        const lines = playlists
            .slice(0, 50)
            .map(playlist => `**${playlist.name}** — ${playlist._count.songs} song${playlist._count.songs === 1 ? '' : 's'}`)
            .join('\n');
        const suffix = playlists.length > 50 ? `\n…and ${playlists.length - 50} more` : '';
        return await ctx.sendMessage({
            embeds: [
                embed
                    .setTitle(target.id === ctx.author?.id ? 'Your playlists' : `Playlists for ${target.username}`)
                    .setDescription(`${lines}${suffix}`.slice(0, 4096)),
            ],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
