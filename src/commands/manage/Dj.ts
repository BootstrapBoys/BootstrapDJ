import { APIRole, ApplicationCommandOptionType, Role } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

type RoleLike = Role | APIRole | null;
type Selection = { sub: string; role: RoleLike };

export default class Dj extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'dj',
            description: {
                content: 'Manage the DJ mode and associated roles',
                examples: ['dj add @role', 'dj remove @role', 'dj clear', 'dj toggle'],
                usage: 'dj',
            },
            category: 'general',
            aliases: ['dj'],
            cooldown: 3,
            args: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [
                {
                    name: 'add',
                    description: 'The dj role you want to add',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: 'role',
                            description: 'The dj role you want to add',
                            type: ApplicationCommandOptionType.Role,
                            required: true,
                        },
                    ],
                },
                {
                    name: 'remove',
                    description: 'The dj role you want to remove',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: 'role',
                            description: 'The dj role you want to remove',
                            type: ApplicationCommandOptionType.Role,
                            required: true,
                        },
                    ],
                },
                {
                    name: 'clear',
                    description: 'Clears all dj roles',
                    type: ApplicationCommandOptionType.Subcommand,
                },
                {
                    name: 'toggle',
                    description: 'Toggles the dj role',
                    type: ApplicationCommandOptionType.Subcommand,
                },
            ],
        });
    }

    private select(ctx: Context, args: string[]): Selection {
        if (ctx.isInteraction && ctx.interaction) {
            const sub = ctx.interaction.options.getSubcommand(false) ?? '';
            const role =
                sub === 'add' || sub === 'remove' ? ctx.interaction.options.getRole('role') : null;
            return { sub, role };
        }

        const mentioned = ctx.message?.mentions.roles.first() ?? null;
        const typed = args[1]
            ? (ctx.guild?.roles.cache.get(args[1].replace(/[<@&>]/g, '')) ?? null)
            : null;
        return { sub: args[0] ?? '', role: mentioned ?? typed };
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

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const { sub, role } = this.select(ctx, args);
        const record = await client.db.getDj(guild.id);

        switch (sub) {
            case 'add': {
                if (!role) return await this.reply(client, ctx, 'Please provide a role to add');
                const roles = await client.db.getRoles(guild.id);
                if (roles.some(entry => entry.roleId === role.id)) {
                    return await this.reply(
                        client,
                        ctx,
                        `The dj role <@&${role.id}> is already added`
                    );
                }
                await client.db.addRole(guild.id, role.id);
                await client.db.setDj(guild.id, true);
                return await this.reply(client, ctx, `The dj role <@&${role.id}> has been added`);
            }
            case 'remove': {
                if (!role) return await this.reply(client, ctx, 'Please provide a role to remove');
                const roles = await client.db.getRoles(guild.id);
                if (!roles.some(entry => entry.roleId === role.id)) {
                    return await this.reply(client, ctx, `The dj role <@&${role.id}> is not added`);
                }
                await client.db.removeRole(guild.id, role.id);
                const remaining = await client.db.getRoles(guild.id);
                // DJ mode with no roles left locks out every non-manager.
                if (remaining.length === 0 && record?.mode) {
                    await client.db.setDj(guild.id, false);
                    return await this.reply(
                        client,
                        ctx,
                        `The dj role <@&${role.id}> has been removed. DJ mode is now disabled because no DJ roles remain.`
                    );
                }
                return await this.reply(client, ctx, `The dj role <@&${role.id}> has been removed`);
            }
            case 'clear':
                if (!record) return await this.reply(client, ctx, 'There are no dj roles to clear');
                await client.db.clearRoles(guild.id);
                if (record.mode) await client.db.setDj(guild.id, false);
                return await this.reply(
                    client,
                    ctx,
                    record.mode
                        ? 'All dj roles have been removed and DJ mode is now disabled'
                        : 'All dj roles have been removed'
                );
            case 'toggle': {
                if (!record)
                    return await this.reply(client, ctx, 'There are no dj roles to toggle');
                const enabled = !record.mode;
                await client.db.setDj(guild.id, enabled);
                return await this.reply(
                    client,
                    ctx,
                    `The dj mode has been toggled to ${enabled ? 'enabled' : 'disabled'}`
                );
            }
            default:
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription('Please provide a valid subcommand')
                            .addFields({
                                name: 'Subcommands',
                                value: '`add`, `remove`, `clear`, `toggle`',
                            }),
                    ],
                });
        }
    }
}
