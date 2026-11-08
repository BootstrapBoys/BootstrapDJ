import { ApplicationCommandOptionType, Role, User } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

type Mentionable = User | Role | null;

export default class Permissions extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'permissions',
            description: {
                content: 'Manage per-command allow/deny rules',
                usage: 'permissions <action> [command] [target]',
                examples: ['permissions list', 'permissions deny play @role'],
            },
            category: 'config',
            aliases: ['permission'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [
                {
                    name: 'action',
                    description: 'List, allow, deny, or reset rules',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'list', value: 'list' },
                        { name: 'allow', value: 'allow' },
                        { name: 'deny', value: 'deny' },
                        { name: 'reset', value: 'reset' },
                        { name: 'claim', value: 'claim' },
                        { name: 'transfer', value: 'transfer' },
                    ],
                },
                {
                    name: 'command',
                    description: 'Command name; omit on reset to clear every rule',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'target',
                    description: 'User or role affected by the rule',
                    type: ApplicationCommandOptionType.Mentionable,
                    required: false,
                },
            ],
        });
    }

    private reply(client: BootstrapClient, ctx: Context, text: string, error: boolean = false): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(error ? client.color.red : client.color.main).setDescription(text)],
        });
    }

    private async transferOwnership(
        client: BootstrapClient,
        ctx: Context,
        action: string,
        selected: Mentionable
    ): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const owner = await client.db.getGuildSetting(guild.id, 'ownerid');

        if (action === 'claim' && owner) {
            return await this.reply(client, ctx, 'This server already has a bot owner.', true);
        }
        if (action === 'transfer' && owner && owner !== author.id && guild.ownerId !== author.id) {
            return await this.reply(
                client,
                ctx,
                'Only the current bot owner or server owner can transfer ownership.',
                true
            );
        }

        const target = action === 'claim' && !selected ? author : selected;
        if (!target || target instanceof Role) {
            return await this.reply(client, ctx, 'Mention the user who should own this bot.', true);
        }
        await client.db.setGuildSetting(guild.id, 'ownerid', target.id);
        return await this.reply(client, ctx, `Bot ownership set to <@${target.id}>.`);
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        const interaction = ctx.interaction;
        if (!guild || !interaction) return;

        const action = interaction.options.getString('action') ?? 'list';
        const commandName = interaction.options.getString('command')?.toLowerCase() ?? null;
        const selected = interaction.options.getMentionable('target') as Mentionable;

        if (action === 'claim' || action === 'transfer') {
            return await this.transferOwnership(client, ctx, action, selected);
        }

        if (action === 'list') {
            const rules = await client.db.getPermissionRules(guild.id);
            if (rules.length === 0) {
                return await this.reply(client, ctx, 'No permission rules are set.');
            }
            const owner = await client.db.getGuildSetting(guild.id, 'ownerid');
            const lines = [
                `**Bot owner:** ${owner ? `<@${owner}>` : 'unclaimed'}`,
                ...rules
                    .slice(0, 20)
                    .map(rule => `${rule.allow ? '✅' : '⛔'} **${rule.command}** — <@${rule.targetId}>`),
            ];
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle('Permission rules')
                        .setDescription(lines.join('\n')),
                ],
            });
        }

        if (action === 'reset') {
            const removed = await client.db.clearPermissionRules(guild.id, commandName ?? undefined);
            return await this.reply(
                client,
                ctx,
                `Cleared ${removed} permission rule${removed === 1 ? '' : 's'}.`
            );
        }

        if (!commandName) {
            return await this.reply(client, ctx, 'Name the command for an allow/deny rule.', true);
        }
        const command = client.commands.get(commandName);
        if (!command) {
            return await this.reply(client, ctx, `Unknown command: **${commandName}**.`, true);
        }
        if (!selected) {
            return await this.reply(client, ctx, 'Mention a user or role for the rule.', true);
        }

        const kind = selected instanceof Role ? 'role' : 'user';
        const rule = await client.db.setPermissionRule(
            guild.id,
            command.name,
            selected.id,
            kind,
            action === 'allow'
        );
        const subject = selected instanceof Role ? selected.name : `<@${selected.id}>`;
        return await this.reply(
            client,
            ctx,
            `${rule.allow ? 'Allowed' : 'Denied'} **${command.name}** for ${subject}.`
        );
    }
}
