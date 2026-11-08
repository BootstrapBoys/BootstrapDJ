import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

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
            description: { content: 'Bot information and utility pages', usage: 'utility <page>', examples: ['utility overview', 'utility stats'] },
            category: 'info',
            aliases: ['bot'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
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
            ctx.isInteraction && ctx.interaction
                ? ctx.interaction.options.data[0]?.name
                : args[0]
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
                        .setTitle('Command status')
                        .setDescription(
                            [
                                `**Loaded commands:** ${client.commands.size}`,
                                `**Slash commands:** ${client.application?.commands.cache.size ?? 'not synced'}`,
                                `**Guild prefix:** \`${guildData?.prefix ?? client.config.prefix}\``,
                                `**Disabled here:** ${disabled.length ? disabled.map(name => `\`${name}\``).join(', ') : 'none'}`,
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
                                'The dashboard is not configured. Set `DASHBOARD_PUBLIC_URL` or `DASHBOARD_OAUTH_REDIRECT_URI`.'
                            ),
                    ],
                });
            }
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle('BootstrapDJ Dashboard')
                        .setDescription(
                            [
                                `[Open the dashboard](${url})`,
                                '',
                                'Sign in with Discord. Only server admins can view or change settings.',
                            ].join('\n')
                        ),
                ],
            });
        }
        const target = page ? TARGETS[page] : 'info';
        const command = target ? client.commands.get(target) : null;
        if (!command) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Unknown utility page.')],
            });
        }
        return await command.run(client, ctx, []);
    }
}
