import {
    type ApplicationCommandOption,
    ApplicationCommandOptionType,
    type ColorResolvable,
} from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import {
    addSongBlacklistEntry,
    getSongBlacklist,
    purgeUserRequests,
    removeSongBlacklistEntry,
    SONGBLACKLIST_MAX,
} from '../../lib/SongBlacklist.js';

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

const BLACKLIST_ACTIONS = new Set(['add', 'remove', 'list']);
const USER_TOKEN = /^(?:<@!?)?(\d{17,20})>?$/;

const PAGE_OPTIONS: ApplicationCommandOption[] = Object.keys(TARGETS).map(name => ({
    name,
    description: `Show ${name}`,
    type: ApplicationCommandOptionType.Subcommand,
}));

const BLACKLIST_OPTION: ApplicationCommandOption = {
    name: 'songblacklist',
    description: 'Blacklist a user from submitting songs (server owner only)',
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            name: 'user',
            description: 'User to blacklist or unblacklist',
            type: ApplicationCommandOptionType.User,
            required: false,
        },
        {
            name: 'action',
            description: 'What to do; defaults to list without a user',
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: 'add', value: 'add' },
                { name: 'remove', value: 'remove' },
                { name: 'list', value: 'list' },
            ],
        },
        {
            name: 'reason',
            description: 'Why they are blacklisted (optional)',
            type: ApplicationCommandOptionType.String,
            required: false,
            maxLength: 200,
        },
    ],
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
            options: [...PAGE_OPTIONS, BLACKLIST_OPTION],
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
        if (page === 'songblacklist') {
            return await this.songBlacklist(client, ctx, args);
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

    /**
     * Server-owner-only song-request blacklist.
     *
     * Slash payloads nest the values under the subcommand, so the raw
     * `options.data[0].options` array is authoritative for both transports.
     */
    private async songBlacklist(
        client: BootstrapClient,
        ctx: Context,
        args: string[]
    ): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;

        if (guild.ownerId !== author.id) {
            return await this.note(
                client,
                ctx,
                tr(ctx, 'longtail:tools.utilityBlacklistOwnerOnly'),
                client.color.red
            );
        }

        const subcommand = ctx.isInteraction ? ctx.interaction?.options.data[0] : null;
        const slashValue = (name: string): string => {
            const option = subcommand?.options?.find(item => item.name === name);
            if (option?.value === undefined || option.value === null) return '';
            return String(option.value);
        };

        let action = ctx.isInteraction ? slashValue('action').toLowerCase() : '';
        let targetId = '';
        let reason = '';

        if (ctx.isInteraction) {
            targetId = slashValue('user');
            reason = slashValue('reason');
        } else {
            const rest = args.slice(1);
            const first = (rest[0] ?? '').toLowerCase();
            if (BLACKLIST_ACTIONS.has(first)) {
                action = first;
                rest.shift();
            }
            targetId = USER_TOKEN.exec(rest[0] ?? '')?.[1] ?? '';
            reason = rest.slice(1).join(' ');
        }

        if (!BLACKLIST_ACTIONS.has(action)) action = targetId ? 'add' : 'list';
        if (action === 'list' || !targetId) {
            return await this.listSongBlacklist(client, ctx);
        }

        const user = await client.users.fetch(targetId).catch(() => null);
        if (!user) {
            return await this.note(
                client,
                ctx,
                tr(ctx, 'longtail:tools.utilityBlacklistUnresolved', { user: targetId }),
                client.color.red
            );
        }
        if (user.bot) {
            return await this.note(
                client,
                ctx,
                tr(ctx, 'longtail:tools.utilityBlacklistBot'),
                client.color.red
            );
        }
        if (user.id === guild.ownerId) {
            return await this.note(
                client,
                ctx,
                tr(ctx, 'longtail:tools.utilityBlacklistSelf'),
                client.color.red
            );
        }

        if (action === 'remove') {
            const removed = await removeSongBlacklistEntry(client, guild.id, user.id);
            return await this.note(
                client,
                ctx,
                tr(
                    ctx,
                    removed
                        ? 'longtail:tools.utilityBlacklistRemoved'
                        : 'longtail:tools.utilityBlacklistNotListed',
                    { user: `<@${user.id}>` }
                ),
                removed ? client.color.main : client.color.red
            );
        }

        const result = await addSongBlacklistEntry(client, guild.id, user.id, author.id, reason);
        if (result === 'full') {
            return await this.note(
                client,
                ctx,
                tr(ctx, 'longtail:tools.utilityBlacklistFull', { count: SONGBLACKLIST_MAX }),
                client.color.red
            );
        }

        const player = client.queue.get(guild.id);
        const removed = player ? await purgeUserRequests(player, user.id) : 0;
        const lines = [
            tr(
                ctx,
                result === 'added'
                    ? 'longtail:tools.utilityBlacklistAdded'
                    : 'longtail:tools.utilityBlacklistUpdated',
                { user: `<@${user.id}>` }
            ),
        ];
        if (removed > 0) {
            lines.push(tr(ctx, 'longtail:tools.utilityBlacklistPurged', { count: removed }));
        }
        return await this.note(client, ctx, lines.join('\n'), client.color.main);
    }

    private async listSongBlacklist(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const entries = await getSongBlacklist(client, guild.id);
        if (entries.length === 0) {
            return await this.note(
                client,
                ctx,
                tr(ctx, 'longtail:tools.utilityBlacklistEmpty'),
                client.color.main
            );
        }
        const noReason = tr(ctx, 'longtail:tools.utilityBlacklistNoReason');
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:tools.utilityBlacklistTitle'))
                    .setDescription(
                        entries
                            .map(entry =>
                                tr(ctx, 'longtail:tools.utilityBlacklistEntry', {
                                    user: `<@${entry.id}>`,
                                    reason: entry.reason || noReason,
                                })
                            )
                            .join('\n')
                    ),
            ],
        });
    }

    private async note(
        client: BootstrapClient,
        ctx: Context,
        description: string,
        color: ColorResolvable
    ): Promise<unknown> {
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(color).setDescription(description)],
        });
    }
}
