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
            return Boolean(channel.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite));
        }) ?? null
    );
}

function formatGuildDate(date: Date): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(date.getDate()).padStart(2, '0')}/${months[date.getMonth()]}/${date.getFullYear()}`;
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

    private rows(page: number, totalPages: number, guilds: Guild[]): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
        const start = page * PAGE_SIZE;
        const menu = new StringSelectMenuBuilder()
            .setCustomId('guild-select')
            .setPlaceholder(`Select a guild (${page + 1}/${totalPages})`)
            .addOptions(
                guilds.slice(start, start + PAGE_SIZE).map(guild =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(guild.name.slice(0, 100))
                        .setDescription(`${guild.memberCount} members · ${guild.id}`.slice(0, 100))
                        .setValue(guild.id)
                )
            );
        const menuRow =
            new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(menu);
        if (totalPages <= 1) return [menuRow];

        const nav =
            new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('guild-page-prev')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('guild-page-next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1)
            );
        return [menuRow, nav];
    }

    private async buildEmbed(guild: Guild): Promise<ReturnType<BootstrapClient['embed']>> {
        const invite = inviteChannel(guild);
        let inviteLink: string | null = null;
        if (invite) {
            const created = await invite
                .createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: 'Owner guild inspection' })
                .catch(() => null);
            if (created) inviteLink = `https://discord.gg/${created.code}`;
        }
        const owner = await guild.fetchOwner().catch(() => null);
        return this.client
            .embed()
            .setColor(this.client.color.main)
            .setTitle('Joined a Guild !!')
            .setThumbnail(guild.iconURL({ size: 256 }) ?? this.client.user?.displayAvatarURL() ?? null)
            .addFields(
                { name: 'Name', value: `\`${guild.name}\`` },
                { name: 'ID', value: `\`${guild.id}\`` },
                {
                    name: 'Owner',
                    value: owner
                        ? `\`${owner.user.username}\`\n\`${owner.user.id}\``
                        : `\`${guild.ownerId}\``,
                },
                { name: 'Member Count', value: `${guild.memberCount} Members` },
                { name: 'Creation Date', value: formatGuildDate(guild.createdAt) },
                {
                    name: 'Guild Invite',
                    value: inviteLink ? `[Here is ${guild.name} invite](${inviteLink})` : 'No invite available',
                },
                {
                    name: `${this.client.user?.username ?? 'BootstrapDJ'}'s Server Count`,
                    value: `${this.client.guilds.cache.size} Servers`,
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
                embeds: [client.embed().setColor(client.color.red).setDescription('The bot is not in any guilds.')],
            });
        }
        const selected = args[0]?.trim();
        if (selected) {
            const guild =
                client.guilds.cache.get(selected) ??
                guilds.find(candidate => candidate.name.toLowerCase() === selected.toLowerCase());
            if (!guild) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('That guild was not found.')],
                });
            }
            return await ctx.sendMessage({ embeds: [await this.buildEmbed(guild)] });
        }
        const totalPages = Math.ceil(guilds.length / PAGE_SIZE);
        let page = 0;
        const message = await ctx.sendMessage({
            content: 'Select a guild to inspect.',
            components: this.rows(page, totalPages, guilds),
        });
        const collector = message.createMessageComponentCollector({ time: 120_000 });
        collector.on('collect', async interaction => {
            if (interaction.user.id !== author.id) {
                await interaction.reply({ content: 'This menu belongs to someone else.', ephemeral: true });
                return;
            }
            if (interaction.isStringSelectMenu() && interaction.customId === 'guild-select') {
                const guild = client.guilds.cache.get(interaction.values[0]);
                if (!guild) {
                    await interaction.reply({ content: 'That guild is no longer available.', ephemeral: true });
                    return;
                }
                await interaction.deferUpdate();
                const embed = await this.buildEmbed(guild);
                await interaction.editReply({ embeds: [embed], components: [] });
                collector.stop('selected');
                return;
            }
            if (interaction.isButton()) {
                if (interaction.customId === 'guild-page-prev') page = Math.max(0, page - 1);
                if (interaction.customId === 'guild-page-next') page = Math.min(totalPages - 1, page + 1);
                await interaction.update({ components: this.rows(page, totalPages, guilds) });
            }
        });
        collector.on('end', async () => {
            await message.edit({ components: [] }).catch(() => null);
        });
        return message;
    }
}
