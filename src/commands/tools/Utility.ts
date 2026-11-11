import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

const TARGETS: Record<string, string> = {
    overview: 'info',
    stats: 'stats',
    shards: 'shards',
    categories: 'categories',
    faq: 'faq',
    tip: 'tip',
    premium: 'premium',
    support: 'support',
    leaderboard: 'leaderboard',
    commands: 'commands',
    dashboard: 'dashboard',
};

export default class Utility extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'utility',
            description: {
                content: 'Bot information and utility pages',
                usage: 'utility <page>',
                examples: ['utility overview', 'utility stats'],
            },
            category: 'info',
            aliases: ['bot'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: Object.keys(TARGETS).map(name => ({
                name,
                description: `Show ${name}`,
                type: ApplicationCommandOptionType.Subcommand,
            })),
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const page = (
            ctx.isInteraction && ctx.interaction ? ctx.interaction.options.data[0]?.name : args[0]
        )?.toLowerCase();
        if (page === 'commands') {
            const guild = ctx.guild;
            if (!guild) return;
            const settings = await client.db.getGuildSettings(guild.id);
            const guildData = await client.db.get(guild.id);
            const disabled = (settings.disabledcommands ?? '')
                .split(',')
                .map(name => name.trim())
                .filter(Boolean);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle(tr(ctx, 'longtail:tools.utilityCommandStatusTitle'))
                        .setDescription(
                            [
                                tr(ctx, 'longtail:tools.utilityLoadedCommands', {
                                    count: client.commands.size,
                                }),
                                tr(ctx, 'longtail:tools.utilitySlashCommands', {
                                    count:
                                        client.application?.commands.cache.size ??
                                        tr(ctx, 'longtail:tools.utilityNotSynced'),
                                }),
                                tr(ctx, 'longtail:tools.utilityGuildPrefix', {
                                    prefix: guildData?.prefix ?? client.config.prefix,
                                }),
                                tr(ctx, 'longtail:tools.utilityDisabledHere', {
                                    commands: disabled.length
                                        ? disabled.map(name => `\`${name}\``).join(', ')
                                        : tr(ctx, 'longtail:tools.utilityNone'),
                                }),
                            ].join('\n')
                        ),
                ],
            });
        }
        if (page === 'dashboard') {
            const configured = client.config.dashboardPublicUrl;
            let url = '';
            if (configured) {
                url = configured;
            } else if (client.config.dashboardOAuthRedirectUri) {
                try {
                    url = new URL(client.config.dashboardOAuthRedirectUri).origin + '/';
                } catch {
                    url = '';
                }
            }
            if (!url) {
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription(
                                tr(ctx, 'longtail:tools.utilityDashboardNotConfigured')
                            ),
                    ],
                });
            }
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle(tr(ctx, 'longtail:tools.utilityDashboardTitle'))
                        .setDescription(
                            [
                                tr(ctx, 'longtail:tools.utilityOpenDashboard', { url }),
                                '',
                                tr(ctx, 'longtail:tools.utilityDashboardSignIn'),
                            ].join('\n')
                        ),
                ],
            });
        }
        const target = page ? TARGETS[page] : 'info';
        const command = target ? client.commands.get(target) : null;
        if (!command) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:tools.utilityUnknownPage')),
                ],
            });
        }
        return await command.run(client, ctx, []);
    }
}
