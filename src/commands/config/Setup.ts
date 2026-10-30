import {
    ApplicationCommandOptionType,
    ChannelType,
    OverwriteType,
    PermissionFlagsBits,
} from 'discord.js';

import { Command, Context, Lavamusic } from '../../structures/index.js';
import { getButtons } from '../../utils/Buttons.js';

export default class Setup extends Command {
    constructor(client: Lavamusic) {
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
            player: {
                voice: false,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks', 'ManageChannels'],
                user: ['ManageGuild'],
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
    public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
        const guild = ctx.guild;
        const clientUser = client.user;
        if (!guild || !clientUser) return;
        let subCommand: string;
        if (ctx.isInteraction) {
            const interaction = ctx.interaction;
            if (!interaction) return;
            subCommand = interaction.options.data[0].name;
        } else {
            subCommand = args[0];
        }
        const embed = client.embed().setColor(client.color.main);
        switch (subCommand) {
            case 'create': {
                const data = await client.db.getSetup(guild.id);

                if (data && data.textId && data.messageId)
                    return await ctx.sendMessage({
                        embeds: [
                            {
                                description: 'The song request channel already exists',
                                color: client.color.red,
                            },
                        ],
                    });
                const textChannel = await guild.channels.create({
                    name: `${clientUser.username}-song-requests`,
                    type: ChannelType.GuildText,
                    topic: 'Song requests for the music bot',
                    permissionOverwrites: [
                        {
                            type: OverwriteType.Member,
                            id: clientUser.id,
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
                const player = this.client.queue.get(guild.id);
                const image = this.client.config.links.img;
                const desc =
                    player && player.queue && player.current
                        ? `[${player.current.info.title}](${player.current.info.uri})`
                        : 'Nothing playing right now';

                embed.setDescription(desc).setImage(image);
                await textChannel
                    .send({
                        embeds: [embed],
                        components: getButtons(),
                    })
                    .then(async msg => {
                        client.db.setSetup(guild.id, textChannel.id, msg.id);
                    });
                const embed2 = client.embed().setColor(client.color.main);
                await ctx.sendMessage({
                    embeds: [
                        embed2.setDescription(
                            `The song request channel has been created in <#${textChannel.id}>`
                        ),
                    ],
                });
                break;
            }
            case 'delete': {
                const data2 = await client.db.getSetup(guild.id);
                if (!data2)
                    return await ctx.sendMessage({
                        embeds: [
                            {
                                description: 'The song request channel doesn\'t exist',
                                color: client.color.red,
                            },
                        ],
                    });
                client.db.deleteSetup(guild.id);
                const channel = guild.channels.cache.get(data2.textId);
                if (channel)
                    await channel.delete().catch(() => {});
                await ctx.sendMessage({
                    embeds: [
                        {
                            description: 'The song request channel has been deleted',
                            color: client.color.main,
                        },
                    ],
                });
                break;
            }

            case 'info': {
                const data3 = await client.db.getSetup(guild.id);
                if (!data3)
                    return await ctx.sendMessage({
                        embeds: [
                            {
                                description: 'The song request channel doesn\'t exist',
                                color: client.color.red,
                            },
                        ],
                    });
                const channel = guild.channels.cache.get(data3.textId);
                if (!channel)
                    return await ctx.sendMessage({
                        embeds: [
                            {
                                description: 'The song request channel doesn\'t exist',
                                color: client.color.red,
                            },
                        ],
                    });
                embed
                    .setDescription(`The song request channel is <#${channel.id}>`)
                    .setColor(client.color.main);
                await ctx.sendMessage({
                    embeds: [embed],
                });
                break;
            }
            default:
                break;
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
