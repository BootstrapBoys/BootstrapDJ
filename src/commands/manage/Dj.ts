import { APIRole, ApplicationCommandOptionType, Role } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

type RoleLike = Role | APIRole | null | undefined;

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
                { name: 'clear', description: 'Clears all dj roles', type: ApplicationCommandOptionType.Subcommand },
                { name: 'toggle', description: 'Toggles the dj role', type: ApplicationCommandOptionType.Subcommand },
            ],
        });
    }

    private resolve(ctx: Context, args: string[]): { sub: string; role: RoleLike } {
        if (ctx.isInteraction) {
            const sub = ctx.interaction?.options.data[0];
            return {
                sub: sub?.name ?? '',
                role: sub?.name === 'add' || sub?.name === 'remove' ? sub.options?.[0]?.role : undefined,
            };
        }
        const message = ctx.message;
        return {
            sub: args[0] ?? '',
            role: message?.mentions.roles.first() ?? ctx.guild?.roles.cache.get(args[1]),
        };
    }

    private reply(client: BootstrapClient, ctx: Context, description: string, error: boolean = false): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(error ? client.color.red : client.color.main).setDescription(description)],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        if (!ctx.guild) return;
        const guild = ctx.guild;
        const { sub, role } = this.resolve(ctx, args);
        const dj = await client.db.getDj(guild.id);

        switch (sub) {
            case 'add': {
                if (!role) return await this.reply(client, ctx, 'Please provide a role to add');
                const roles = await client.db.getRoles(guild.id);
                if (roles.some((entry: { roleId: string }) => entry.roleId === role.id)) {
                    return await this.reply(client, ctx, `The dj role <@&${role.id}> is already added`);
                }
                await client.db.addRole(guild.id, role.id);
                await client.db.setDj(guild.id, true);
                return await this.reply(client, ctx, `The dj role <@&${role.id}> has been added`);
            }
            case 'remove': {
                if (!role) return await this.reply(client, ctx, 'Please provide a role to remove');
                const roles = await client.db.getRoles(guild.id);
                if (!roles.some((entry: { roleId: string }) => entry.roleId === role.id)) {
                    return await this.reply(client, ctx, `The dj role <@&${role.id}> is not added`);
                }
                await client.db.removeRole(guild.id, role.id);
                return await this.reply(client, ctx, `The dj role <@&${role.id}> has been removed`);
            }
            case 'clear':
                if (!dj) return await this.reply(client, ctx, 'There are no dj roles to clear');
                await client.db.clearRoles(guild.id);
                return await this.reply(client, ctx, 'All dj roles have been removed');
            case 'toggle': {
                if (!dj) return await this.reply(client, ctx, 'There are no dj roles to toggle');
                const next = !dj.mode;
                await client.db.setDj(guild.id, next);
                return await this.reply(client, ctx, `The dj mode has been toggled to ${next ? 'enabled' : 'disabled'}`);
            }
            default:
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription('Please provide a valid subcommand')
                            .addFields({ name: 'Subcommands', value: '`add`, `remove`, `clear`, `toggle`' }),
                    ],
                });
        }
    }
}
