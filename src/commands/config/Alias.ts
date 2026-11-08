import { ApplicationCommandOptionType, GuildMember, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Alias extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'alias',
            description: { content: 'Create, list, or remove custom command aliases', usage: 'alias <action> [alias] [command]', examples: ['alias add b play', 'alias list'] },
            category: 'config',
            aliases: ['aliases'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
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

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        const member = ctx.member;
        const author = ctx.author;
        if (!guild || !member || !author || !(member instanceof GuildMember)) return;
        const get = (name: string): string | null => {
            if (ctx.isInteraction && ctx.interaction) {
                return ctx.interaction.options.getString(name) ?? null;
            }
            const index = ['action', 'alias', 'command', 'scope'].indexOf(name);
            return ctx.args[index] ?? null;
        };
        const action = (get('action') ?? 'list').toLowerCase();
        const scope = get('scope') === 'user' ? 'user' : 'server';
        if (scope === 'server' && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('You need Manage Server for server aliases.')],
            });
        }
        const userId = scope === 'user' ? author.id : '';

        if (action === 'list') {
            const aliases = await client.db.listCommandAliases(guild.id, author.id);
            if (!aliases.length) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.main).setDescription('No custom aliases are set.')],
                });
            }
            const lines = aliases.map(alias => `\`${alias.alias}\` → \`${alias.command}\` (${alias.scope})`);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle('Custom aliases')
                        .setDescription(lines.join('\n').slice(0, 4096)),
                ],
            });
        }

        if (action === 'clear') {
            const removed = await client.db.clearCommandAliases(guild.id, scope, userId);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.green)
                        .setDescription(`Cleared ${removed} ${scope} alias${removed === 1 ? '' : 'es'}.`),
                ],
            });
        }

        const alias = (get('alias') ?? '').toLowerCase().trim();
        if (!/^[a-z0-9_-]{1,32}$/.test(alias)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Alias names must be 1–32 letters, numbers, `_` or `-`.')],
            });
        }
        if (action === 'remove') {
            const removed = await client.db.deleteCommandAlias(guild.id, scope, userId, alias);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(removed ? client.color.green : client.color.red)
                        .setDescription(removed ? `Removed alias \`${alias}\`.` : `No alias \`${alias}\` exists.`),
                ],
            });
        }

        const target = (get('command') ?? '').toLowerCase().replace(/^[^\w]+/, '');
        if (!client.commands.has(target)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription(`Unknown command: **${target || 'none'}**.`)],
            });
        }
        if (client.commands.has(alias) || client.aliases.has(alias)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription(`\`${alias}\` is already a command or alias.`)],
            });
        }
        await client.db.setCommandAlias(guild.id, scope, userId, alias, target);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(`Alias \`${alias}\` → \`${target}\` (${scope}) created.`),
            ],
        });
    }
}
