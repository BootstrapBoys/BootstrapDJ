import { ApplicationCommandOptionType, User } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

const MAX_ROWS = 50;

export default class List extends Command {
    public constructor(client: BootstrapClient) {
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
            player: { voice: false, dj: false, active: false, djPerm: null },
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

    private async target(client: BootstrapClient, ctx: Context): Promise<User | null> {
        if (ctx.isInteraction && ctx.interaction) {
            return ctx.interaction.options.getUser('user') ?? ctx.author;
        }
        const raw = ctx.args[0];
        if (!raw) return ctx.author;
        return await client.users.fetch(raw.replace(/[<@!>]/g, '')).catch(() => null);
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const target = await this.target(client, ctx);
        if (!target) return;

        const playlists = await client.db.getPlaylists(target.id);
        const own = target.id === ctx.author?.id;
        const embed = client.embed().setColor(client.color.main);

        if (playlists.length === 0) {
            return await ctx.sendMessage({
                embeds: [
                    embed.setDescription(
                        own
                            ? "You don't have any playlists."
                            : `${target.username} doesn't have any playlists.`
                    ),
                ],
            });
        }

        const rows = playlists
            .slice(0, MAX_ROWS)
            .map(
                item =>
                    `**${item.name}** — ${item._count.songs} song${item._count.songs === 1 ? '' : 's'}`
            );
        const extra =
            playlists.length > MAX_ROWS ? `\n…and ${playlists.length - MAX_ROWS} more` : '';
        return await ctx.sendMessage({
            embeds: [
                embed
                    .setTitle(own ? 'Your playlists' : `Playlists for ${target.username}`)
                    .setDescription(`${rows.join('\n')}${extra}`.slice(0, 4096)),
            ],
        });
    }
}
