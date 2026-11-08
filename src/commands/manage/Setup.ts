import {
    ApplicationCommandOptionType,
    ChannelType,
    OverwriteType,
    PermissionFlagsBits,
} from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { getButtons } from '../../lib/Buttons.js';
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
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [
                { name: 'create', description: 'Creates the song request channel', type: ApplicationCommandOptionType.Subcommand },
                { name: 'delete', description: 'Deletes the song request channel', type: ApplicationCommandOptionType.Subcommand },
                { name: 'info', description: 'Shows the song request channel', type: ApplicationCommandOptionType.Subcommand },
            ],
        });
    }

    private subcommand(ctx: Context, args: string[]): string {
        return ctx.isInteraction
            ? (ctx.interaction?.options.data[0]?.name ?? '')
            : (args[0] ?? '');
    }

    private async createChannel(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        const me = client.user;
        if (!guild || !me) return;
        const existing = await client.db.getSetup(guild.id);
        if (existing?.textId && existing.messageId) {
            return await ctx.sendMessage({
                embeds: [{ description: 'The song request channel already exists', color: client.color.red }],
            });
        }

        const channel = await guild.channels.create({
            name: `${me.username}-song-requests`,
            type: ChannelType.GuildText,
            topic: 'Song requests for the music bot',
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

        const player = client.queue.get(guild.id);
        const description =
            player?.queue && player.current
                ? `[${player.current.info.title}](${player.current.info.uri})`
                : 'Nothing playing right now';
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
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`The song request channel has been created in <#${channel.id}>`),
            ],
        });
    }

    private async deleteChannel(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const setup = await client.db.getSetup(guild.id);
        if (!setup) {
            return await ctx.sendMessage({
                embeds: [{ description: 'The song request channel doesn\'t exist', color: client.color.red }],
            });
        }
        await client.db.deleteSetup(guild.id);
        stopSetupJanitor(guild.id);
        await guild.channels.cache.get(setup.textId)?.delete().catch(() => {});
        return await ctx.sendMessage({
            embeds: [{ description: 'The song request channel has been deleted', color: client.color.main }],
        });
    }

    private async channelInfo(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const setup = await client.db.getSetup(guild.id);
        const channel = setup ? guild.channels.cache.get(setup.textId) : undefined;
        if (!channel) {
            return await ctx.sendMessage({
                embeds: [{ description: 'The song request channel doesn\'t exist', color: client.color.red }],
            });
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`The song request channel is <#${channel.id}>`),
            ],
        });
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
