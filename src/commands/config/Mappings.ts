import { ApplicationCommandOptionType, GuildMember, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Mappings extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'mappings',
            description: { content: 'Create custom prefix shortcut expansions', usage: 'mappings <action> [trigger] [expansion]', examples: ['mappings add rickroll play https://…'] },
            category: 'config',
            aliases: ['mapping'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
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
                { name: 'trigger', description: 'Word typed after the prefix', type: ApplicationCommandOptionType.String, required: false },
                { name: 'expansion', description: 'Command and arguments to run', type: ApplicationCommandOptionType.String, required: false },
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
            if (ctx.isInteraction && ctx.interaction) return ctx.interaction.options.getString(name) ?? null;
            const index = ['action', 'trigger', 'expansion', 'scope'].indexOf(name);
            return ctx.args[index] ?? null;
        };
        const action = (get('action') ?? 'list').toLowerCase();
        const scope = get('scope') === 'user' ? 'user' : 'server';
        if (scope === 'server' && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('You need Manage Server for server mappings.')],
            });
        }
        const userId = scope === 'user' ? author.id : '';

        if (action === 'list') {
            const mappings = await client.db.listCommandMappings(guild.id, author.id);
            if (!mappings.length) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.main).setDescription('No custom mappings are set.')],
                });
            }
            const lines = mappings.map(mapping => `\`${mapping.trigger}\` → \`${mapping.expansion}\` (${mapping.scope})`);
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

        if (action === 'clear') {
            const removed = await client.db.clearCommandMappings(guild.id, scope, userId);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.green)
                        .setDescription(`Cleared ${removed} ${scope} mapping${removed === 1 ? '' : 's'}.`),
                ],
            });
        }

        const trigger = (get('trigger') ?? '').toLowerCase().trim();
        if (!/^[a-z0-9_-]{1,32}$/.test(trigger)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Triggers must be 1–32 letters, numbers, `_` or `-`.')],
            });
        }
        if (action === 'remove') {
            const removed = await client.db.deleteCommandMapping(guild.id, scope, userId, trigger);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(removed ? client.color.green : client.color.red)
                        .setDescription(removed ? `Removed mapping \`${trigger}\`.` : `No mapping \`${trigger}\` exists.`),
                ],
            });
        }
        const expansion = (get('expansion') ?? '').trim();
        if (!expansion) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Provide the command expansion.')],
            });
        }
        const target = expansion.split(/\s+/)[0]?.replace(/^[^\w]+/, '').toLowerCase();
        if (!target || !client.commands.has(target)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription(`The expansion must start with a command; \`${target || 'none'}\` is unknown.`)],
            });
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
