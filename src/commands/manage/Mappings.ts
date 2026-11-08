import { ApplicationCommandOptionType, GuildMember, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

type Scope = 'server' | 'user';

export default class Mappings extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'mappings',
            description: {
                content: 'Create custom prefix shortcut expansions',
                usage: 'mappings <action> [trigger] [expansion]',
                examples: ['mappings add rickroll play https://…'],
            },
            category: 'config',
            aliases: ['mapping'],
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
                    description: 'Add, remove, list, or clear mappings',
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
                    name: 'trigger',
                    description: 'Word typed after the prefix',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'expansion',
                    description: 'Command and arguments to run',
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

    private read(ctx: Context): {
        action: string;
        scope: Scope;
        trigger: string;
        expansion: string;
    } {
        if (ctx.isInteraction && ctx.interaction) {
            const scopeRaw = (ctx.interaction.options.getString('scope') ?? '').trim();
            return {
                action: (ctx.interaction.options.getString('action') ?? 'list').toLowerCase(),
                scope: scopeRaw === 'user' ? 'user' : 'server',
                trigger: (ctx.interaction.options.getString('trigger') ?? '').trim().toLowerCase(),
                expansion: (ctx.interaction.options.getString('expansion') ?? '').trim(),
            };
        }

        const args = ctx.args;
        const action = (args[0] ?? 'list').trim().toLowerCase();
        let scopeRaw = '';
        let trigger = '';
        let expansion = '';
        if (action === 'clear') {
            scopeRaw = args[1] ?? '';
        } else if (action === 'remove') {
            trigger = args[1] ?? '';
            scopeRaw = args[2] ?? '';
        } else if (action === 'add') {
            trigger = args[1] ?? '';
            // The expansion is every remaining word. A trailing server/user
            // token is the scope; anything else is part of the command.
            const words = args.slice(2);
            const last = words[words.length - 1]?.toLowerCase();
            if (last === 'server' || last === 'user') scopeRaw = words.pop() ?? '';
            expansion = words.join(' ');
        }
        return {
            action,
            scope: scopeRaw.trim().toLowerCase() === 'user' ? 'user' : 'server',
            trigger: trigger.trim().toLowerCase(),
            expansion: expansion.trim(),
        };
    }

    private reply(client: BootstrapClient, ctx: Context, text: string, error: boolean = false): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(error ? client.color.red : client.color.main).setDescription(text)],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        const member = ctx.member;
        if (!guild || !author || !(member instanceof GuildMember)) return;

        const request = this.read(ctx);
        const { action, scope, trigger, expansion } = request;
        if (scope === 'server' && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return await this.reply(client, ctx, 'You need Manage Server for server mappings.', true);
        }
        const userId = scope === 'user' ? author.id : '';

        switch (action) {
            case 'list': {
                const mappings = await client.db.listCommandMappings(guild.id, author.id);
                if (mappings.length === 0) {
                    return await this.reply(client, ctx, 'No custom mappings are set.');
                }
                const lines = mappings.map(entry => `\`${entry.trigger}\` → \`${entry.expansion}\` (${entry.scope})`);
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.main)
                            .setTitle('Custom mappings')
                            .setDescription(lines.join('\n').slice(0, 4096)),
                    ],
                });
            }
            case 'clear': {
                const removed = await client.db.clearCommandMappings(guild.id, scope, userId);
                return await this.reply(
                    client,
                    ctx,
                    `Cleared ${removed} ${scope} mapping${removed === 1 ? '' : 's'}.`
                );
            }
            default:
                break;
        }

        if (!/^[a-z0-9_-]{1,32}$/.test(trigger)) {
            return await this.reply(client, ctx, 'Triggers must be 1–32 letters, numbers, `_` or `-`.', true);
        }

        if (action === 'remove') {
            const removed = await client.db.deleteCommandMapping(guild.id, scope, userId, trigger);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(removed ? client.color.green : client.color.red)
                        .setDescription(
                            removed ? `Removed mapping \`${trigger}\`.` : `No mapping \`${trigger}\` exists.`
                        ),
                ],
            });
        }

        if (!expansion) return await this.reply(client, ctx, 'Provide the command expansion.', true);
        const target = expansion.split(/\s+/)[0]?.replace(/^[^\w]+/, '').toLowerCase();
        if (!target || !client.commands.has(target)) {
            return await this.reply(
                client,
                ctx,
                `The expansion must start with a command; \`${target || 'none'}\` is unknown.`,
                true
            );
        }

        await client.db.setCommandMapping(guild.id, scope, userId, trigger, expansion);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(`Mapping \`${trigger}\` → \`${expansion}\` (${scope}) created.`),
            ],
        });
    }
}
