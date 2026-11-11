import {
    ActionRowBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Guild,
    NewsChannel,
    PermissionFlagsBits,
    StageChannel,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextChannel,
    VoiceChannel,
} from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

const PAGE_SIZE = 25;

type InvitableChannel = TextChannel | NewsChannel | VoiceChannel | StageChannel;

function inviteChannel(guild: Guild): InvitableChannel | null {
    const me = guild.members.me;
    if (!me) return null;
    return (
        guild.channels.cache.find((channel): channel is InvitableChannel => {
            if (
                channel.type !== ChannelType.GuildText &&
                channel.type !== ChannelType.GuildNews &&
                channel.type !== ChannelType.GuildVoice &&
                channel.type !== ChannelType.GuildStageVoice
            ) {
                return false;
            }
            return Boolean(
                channel.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite)
            );
        }) ?? null
    );
}

function formatGuildDate(ctx: Context, date: Date): string {
    const month = tr(ctx, `longtail:owner.month${date.getMonth() + 1}`);
    return `${String(date.getDate()).padStart(2, '0')}/${month}/${date.getFullYear()}`;
}

export default class GuildCommand extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'guild',
            description: {
                content: 'Inspect a guild the bot is currently in',
                usage: 'guild',
                examples: ['guild'],
            },
            category: 'dev',
            aliases: ['guildinfo'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: true,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'guild',
                    description: 'Guild name or ID (autocompletes)',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    autocomplete: true,
                },
            ],
        });
    }

    private pages(): Guild[] {
        return [...this.client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    private rows(
        ctx: Context,
        page: number,
        totalPages: number,
        guilds: Guild[]
    ): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
        const start = page * PAGE_SIZE;
        const menu = new StringSelectMenuBuilder()
            .setCustomId('guild-select')
            .setPlaceholder(
                tr(ctx, 'longtail:owner.guildPlaceholder', {
                    page: page + 1,
                    total: totalPages,
                })
            )
            .addOptions(
                guilds.slice(start, start + PAGE_SIZE).map(guild =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(guild.name.slice(0, 100))
                        .setDescription(
                            tr(ctx, 'longtail:owner.guildOption', {
                                members: guild.memberCount,
                                id: guild.id,
                            }).slice(0, 100)
                        )
                        .setValue(guild.id)
                )
            );
        const menuRow = new ActionRowBuilder<
            StringSelectMenuBuilder | ButtonBuilder
        >().addComponents(menu);
        if (totalPages <= 1) return [menuRow];

        const nav = new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('guild-page-prev')
                .setLabel(tr(ctx, 'longtail:owner.guildPrevious'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('guild-page-next')
                .setLabel(tr(ctx, 'longtail:owner.guildNext'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );
        return [menuRow, nav];
    }

    private async buildEmbed(
        ctx: Context,
        guild: Guild
    ): Promise<ReturnType<BootstrapClient['embed']>> {
        const invite = inviteChannel(guild);
        let inviteLink: string | null = null;
        if (invite) {
            const created = await invite
                .createInvite({
                    maxAge: 0,
                    maxUses: 0,
                    unique: true,
                    reason: tr(ctx, 'longtail:owner.guildInviteReason'),
                })
                .catch(() => null);
            if (created) inviteLink = `https://discord.gg/${created.code}`;
        }
        const owner = await guild.fetchOwner().catch(() => null);
        return this.client
            .embed()
            .setColor(this.client.color.main)
            .setTitle(tr(ctx, 'longtail:owner.guildJoinedTitle'))
            .setThumbnail(
                guild.iconURL({ size: 256 }) ?? this.client.user?.displayAvatarURL() ?? null
            )
            .addFields(
                { name: tr(ctx, 'longtail:owner.guildName'), value: `\`${guild.name}\`` },
                { name: tr(ctx, 'longtail:owner.guildIdLabel'), value: `\`${guild.id}\`` },
                {
                    name: tr(ctx, 'longtail:owner.guildOwner'),
                    value: owner
                        ? `\`${owner.user.username}\`\n\`${owner.user.id}\``
                        : `\`${guild.ownerId}\``,
                },
                {
                    name: tr(ctx, 'longtail:owner.guildMemberCount'),
                    value: tr(ctx, 'longtail:owner.guildMembers', { count: guild.memberCount }),
                },
                {
                    name: tr(ctx, 'longtail:owner.guildCreationDate'),
                    value: formatGuildDate(ctx, guild.createdAt),
                },
                {
                    name: tr(ctx, 'longtail:owner.guildInvite'),
                    value: inviteLink
                        ? tr(ctx, 'longtail:owner.guildInviteLink', {
                              guild: guild.name,
                              link: inviteLink,
                          })
                        : tr(ctx, 'longtail:owner.guildNoInvite'),
                },
                {
                    name: tr(ctx, 'longtail:owner.guildServerCount', {
                        bot: this.client.user?.username ?? 'BootstrapDJ',
                    }),
                    value: tr(ctx, 'longtail:owner.guildServers', {
                        count: this.client.guilds.cache.size,
                    }),
                }
            )
            .setTimestamp(guild.joinedAt ?? new Date());
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const guilds = this.pages();
        if (!guilds.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:owner.guildNone')),
                ],
            });
        }
        const selected = args[0]?.trim();
        if (selected) {
            const guild =
                client.guilds.cache.get(selected) ??
                guilds.find(candidate => candidate.name.toLowerCase() === selected.toLowerCase());
            if (!guild) {
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription(tr(ctx, 'longtail:owner.guildNotFound')),
                    ],
                });
            }
            // fetchOwner plus an invite creation can exceed Discord's three
            // second reply deadline; acknowledge first.
            await ctx.defer();
            return await ctx.sendMessage({ embeds: [await this.buildEmbed(ctx, guild)] });
        }
        const totalPages = Math.ceil(guilds.length / PAGE_SIZE);
        let page = 0;
        const message = await ctx.sendMessage({
            content: tr(ctx, 'longtail:owner.guildSelectPrompt'),
            components: this.rows(ctx, page, totalPages, guilds),
        });
        const collector = message.createMessageComponentCollector({ time: 120_000 });
        collector.on('collect', async interaction => {
            if (interaction.user.id !== author.id) {
                await interaction.reply({
                    content: tr(ctx, 'longtail:owner.guildNotYours'),
                    ephemeral: true,
                });
                return;
            }
            if (interaction.isStringSelectMenu() && interaction.customId === 'guild-select') {
                const guild = client.guilds.cache.get(interaction.values[0]);
                if (!guild) {
                    await interaction.reply({
                        content: tr(ctx, 'longtail:owner.guildGone'),
                        ephemeral: true,
                    });
                    return;
                }
                await interaction.deferUpdate();
                const embed = await this.buildEmbed(ctx, guild);
                await interaction.editReply({ embeds: [embed], components: [] });
                collector.stop('selected');
                return;
            }
            if (interaction.isButton()) {
                if (interaction.customId === 'guild-page-prev') page = Math.max(0, page - 1);
                if (interaction.customId === 'guild-page-next')
                    page = Math.min(totalPages - 1, page + 1);
                await interaction.update({ components: this.rows(ctx, page, totalPages, guilds) });
            }
        });
        collector.on('end', async () => {
            await message.edit({ components: [] }).catch(() => null);
        });
        return message;
    }
}
