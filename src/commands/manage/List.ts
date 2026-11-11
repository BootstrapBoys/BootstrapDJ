import { ApplicationCommandOptionType, User } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

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

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:manage.list.${key}`, variables);
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
                            ? this.copy(ctx, 'noneOwn')
                            : this.copy(ctx, 'noneOther', { username: target.username })
                    ),
                ],
            });
        }

        const rows = playlists.slice(0, MAX_ROWS).map(item =>
            this.copy(ctx, item._count.songs === 1 ? 'row' : 'rowPlural', {
                name: item.name,
                count: item._count.songs,
            })
        );
        const extra =
            playlists.length > MAX_ROWS
                ? `\n${this.copy(ctx, 'more', { count: playlists.length - MAX_ROWS })}`
                : '';
        return await ctx.sendMessage({
            embeds: [
                embed
                    .setTitle(
                        own
                            ? this.copy(ctx, 'titleOwn')
                            : this.copy(ctx, 'titleOther', { username: target.username })
                    )
                    .setDescription(`${rows.join('\n')}${extra}`.slice(0, 4096)),
            ],
        });
    }
}
