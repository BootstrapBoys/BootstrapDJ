import {
    ApplicationCommandOptionType,
    ChannelType,
    OverwriteType,
    PermissionFlagsBits,
} from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { getButtons } from '../../lib/Buttons.js';
import { tr } from '../../lib/i18nContext.js';
import { startSetupJanitor, stopSetupJanitor } from '../../lib/SetupSystem.js';

export default class Setup extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'setup',
            description: {
                content: 'Sets up the bot',
                examples: ['setup create', 'setup delete', 'setup info'],
                usage: 'setup',
            },
            category: 'config',
            aliases: ['setup'],
            cooldown: 3,
            args: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks', 'ManageChannels'],
                user: ['ManageGuild', 'ManageRoles'],
            },
            slashCommand: true,
            options: [
                {
                    name: 'create',
                    description: 'Creates the song request channel',
                    type: ApplicationCommandOptionType.Subcommand,
                },
                {
                    name: 'delete',
                    description: 'Deletes the song request channel',
                    type: ApplicationCommandOptionType.Subcommand,
                },
                {
                    name: 'info',
                    description: 'Shows the song request channel',
                    type: ApplicationCommandOptionType.Subcommand,
                },
            ],
        });
    }

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:manage.setup.${key}`, variables);
    }

    private subcommand(ctx: Context, args: string[]): string {
        if (ctx.isInteraction && ctx.interaction) {
            return ctx.interaction.options.getSubcommand(false) ?? '';
        }
        return args[0] ?? '';
    }

    private reply(
        client: BootstrapClient,
        ctx: Context,
        text: string,
        colour: number
    ): Promise<unknown> {
        return ctx.sendMessage({ embeds: [{ description: text, color: colour }] });
    }

    private async createChannel(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        const me = client.user;
        if (!guild || !me) return;

        const existing = await client.db.getSetup(guild.id);
        if (existing?.textId && existing.messageId) {
            return await this.reply(client, ctx, this.copy(ctx, 'exists'), client.color.red);
        }

        const channel = await guild.channels.create({
            name: `${me.username}-song-requests`,
            type: ChannelType.GuildText,
            topic: this.copy(ctx, 'topic'),
            permissionOverwrites: [
                {
                    type: OverwriteType.Member,
                    id: me.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory,
                    ],
                },
                {
                    type: OverwriteType.Role,
                    id: guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                    ],
                },
            ],
        });

        const current = client.queue.get(guild.id)?.current;
        const description = current
            ? `[${current.info.title}](${current.info.uri})`
            : this.copy(ctx, 'nothingPlaying');
        const mock = await channel.send({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(description)
                    .setImage(client.config.links.img),
            ],
            components: getButtons(),
        });

        await client.db.setSetup(guild.id, channel.id, mock.id);
        startSetupJanitor(client, guild.id);
        return await this.reply(
            client,
            ctx,
            this.copy(ctx, 'created', { id: channel.id }),
            client.color.main
        );
    }

    private async deleteChannel(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const setup = await client.db.getSetup(guild.id);
        if (!setup) {
            return await this.reply(client, ctx, this.copy(ctx, 'notExist'), client.color.red);
        }

        await client.db.deleteSetup(guild.id);
        stopSetupJanitor(guild.id);
        await guild.channels.cache
            .get(setup.textId)
            ?.delete()
            .catch(() => {});
        return await this.reply(client, ctx, this.copy(ctx, 'deleted'), client.color.main);
    }

    private async channelInfo(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const setup = await client.db.getSetup(guild.id);
        const channel = setup ? guild.channels.cache.get(setup.textId) : undefined;
        if (!channel) {
            return await this.reply(client, ctx, this.copy(ctx, 'notExist'), client.color.red);
        }
        return await this.reply(
            client,
            ctx,
            this.copy(ctx, 'info', { id: channel.id }),
            client.color.main
        );
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        switch (this.subcommand(ctx, args)) {
            case 'create':
                return await this.createChannel(client, ctx);
            case 'delete':
                return await this.deleteChannel(client, ctx);
            case 'info':
                return await this.channelInfo(client, ctx);
            default:
                return undefined;
        }
    }
}
