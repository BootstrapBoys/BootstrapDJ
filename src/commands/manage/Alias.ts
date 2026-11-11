import { ApplicationCommandOptionType, GuildMember, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

type AliasScope = 'server' | 'user';

const FIELDS = ['action', 'alias', 'command', 'scope'] as const;

export default class Alias extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'alias',
            description: {
                content: 'Create, list, or remove custom command aliases',
                usage: 'alias <action> [alias] [command]',
                examples: ['alias add b play', 'alias list'],
            },
            category: 'config',
            aliases: ['aliases'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'action',
                    description: 'Add, remove, list, or clear aliases',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'add', value: 'add' },
                        { name: 'remove', value: 'remove' },
                        { name: 'list', value: 'list' },
                        { name: 'clear', value: 'clear' },
                    ],
                },
                {
                    name: 'alias',
                    description: 'Alias name',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'command',
                    description: 'Target command for add',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'scope',
                    description: 'Server-wide or only for you',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: [
                        { name: 'server', value: 'server' },
                        { name: 'user', value: 'user' },
                    ],
                },
            ],
        });
    }

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:manage.alias.${key}`, variables);
    }

    private field(ctx: Context, field: (typeof FIELDS)[number]): string {
        if (ctx.isInteraction && ctx.interaction) {
            return (ctx.interaction.options.getString(field) ?? '').trim();
        }
        return (ctx.args[FIELDS.indexOf(field)] ?? '').trim();
    }

    private reply(
        client: BootstrapClient,
        ctx: Context,
        text: string,
        error: boolean = false
    ): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(error ? client.color.red : client.color.main)
                    .setDescription(text),
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        const member = ctx.member;
        if (!guild || !author || !(member instanceof GuildMember)) return;

        const action = (this.field(ctx, 'action') || 'list').toLowerCase();
        const scope: AliasScope = this.field(ctx, 'scope') === 'user' ? 'user' : 'server';
        if (scope === 'server' && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return await this.reply(client, ctx, this.copy(ctx, 'manageServer'), true);
        }
        const userId = scope === 'user' ? author.id : '';

        switch (action) {
            case 'list': {
                const aliases = await client.db.listCommandAliases(guild.id, author.id);
                if (aliases.length === 0) {
                    return await this.reply(client, ctx, this.copy(ctx, 'noAliases'));
                }
                const lines = aliases.map(
                    entry => `\`${entry.alias}\` → \`${entry.command}\` (${entry.scope})`
                );
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.main)
                            .setTitle(this.copy(ctx, 'listTitle'))
                            .setDescription(lines.join('\n').slice(0, 4096)),
                    ],
                });
            }
            case 'clear': {
                const removed = await client.db.clearCommandAliases(guild.id, scope, userId);
                return await this.reply(
                    client,
                    ctx,
                    this.copy(ctx, removed === 1 ? 'cleared' : 'clearedPlural', {
                        count: removed,
                        scope,
                    })
                );
            }
            default:
                break;
        }

        const alias = this.field(ctx, 'alias').toLowerCase();
        if (!/^[a-z0-9_-]{1,32}$/.test(alias)) {
            return await this.reply(client, ctx, this.copy(ctx, 'invalid'), true);
        }

        if (action === 'remove') {
            const removed = await client.db.deleteCommandAlias(guild.id, scope, userId, alias);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(removed ? client.color.green : client.color.red)
                        .setDescription(
                            this.copy(ctx, removed ? 'removed' : 'notFound', { alias })
                        ),
                ],
            });
        }

        const target = this.field(ctx, 'command')
            .toLowerCase()
            .replace(/^[^\w]+/, '');
        if (!client.commands.has(target)) {
            return await this.reply(
                client,
                ctx,
                this.copy(ctx, 'unknownCommand', { target: target || 'none' }),
                true
            );
        }
        if (client.commands.has(alias) || client.aliases.has(alias)) {
            return await this.reply(client, ctx, this.copy(ctx, 'alreadyExists', { alias }), true);
        }

        await client.db.setCommandAlias(guild.id, scope, userId, alias, target);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(this.copy(ctx, 'created', { alias, target, scope })),
            ],
        });
    }
}
