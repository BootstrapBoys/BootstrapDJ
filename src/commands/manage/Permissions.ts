import { ApplicationCommandOptionType, Role, User } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Permissions extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'permissions',
            description: { content: 'Manage per-command allow/deny rules', usage: 'permissions <action> [command] [target]', examples: ['permissions list', 'permissions deny play @role'] },
            category: 'config',
            aliases: ['permission'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: ['ManageGuild'] },
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

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild || !ctx.isInteraction || !ctx.interaction) return;
        const action = String(ctx.interaction.options.getString('action') ?? 'list');
        const commandName = ctx.interaction.options.getString('command')?.toLowerCase() ?? null;

        if (action === 'claim' || action === 'transfer') {
            const owner = await client.db.getGuildSetting(guild.id, 'ownerid');
            if (action === 'claim' && owner) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('This server already has a bot owner.')],
                });
            }
            if (action === 'transfer' && owner && owner !== ctx.author?.id && guild.ownerId !== ctx.author?.id) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Only the current bot owner or server owner can transfer ownership.')],
                });
            }
            const selected = ctx.interaction.options.getMentionable('target') as User | Role | null;
            const target = action === 'claim' && !selected ? ctx.author : selected;
            if (!target || target instanceof Role) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Mention the user who should own this bot.')],
                });
            }
            await client.db.setGuildSetting(guild.id, 'ownerid', target.id);
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.green).setDescription(`Bot ownership set to <@${target.id}>.`)],
            });
        }

        if (action === 'list') {
            const rules = await client.db.getPermissionRules(guild.id);
            if (!rules.length) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.main).setDescription('No permission rules are set.')],
                });
            }
            const owner = await client.db.getGuildSetting(guild.id, 'ownerid');
            const lines = [
                `**Bot owner:** ${owner ? `<@${owner}>` : 'unclaimed'}`,
                ...rules.slice(0, 20).map(rule => `${rule.allow ? '✅' : '⛔'} **${rule.command}** — <@${rule.targetId}>`),
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
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.green)
                        .setDescription(`Cleared ${removed} permission rule${removed === 1 ? '' : 's'}.`),
                ],
            });
        }

        if (!commandName) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Name the command for an allow/deny rule.')],
            });
        }
        const command = client.commands.get(commandName);
        if (!command) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription(`Unknown command: **${commandName}**.`)],
            });
        }
        const target = ctx.interaction.options.getMentionable('target') as User | Role | null;
        if (!target) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Mention a user or role for the rule.')],
            });
        }
        const kind = target instanceof Role ? 'role' : 'user';
        const rule = await client.db.setPermissionRule(
            guild.id,
            command.name,
            target.id,
            kind,
            action === 'allow'
        );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(
                        `${rule.allow ? 'Allowed' : 'Denied'} **${command.name}** for ${target instanceof Role ? target.name : `<@${target.id}>`}.`
                    ),
            ],
        });
    }
}
