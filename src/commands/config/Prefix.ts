import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Prefix extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'prefix',
            description: {
                content: 'Shows the bot\'s prefix',
                examples: ['prefix set', 'prefix reset', 'prefix set !'],
                usage: 'prefix set, prefix reset, prefix set !',
            },
            category: 'general',
            aliases: ['prefix'],
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
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [
                {
                    name: 'set',
                    description: 'Sets the prefix',
                    type: 1,
                    options: [
                        {
                            name: 'prefix',
                            description: 'The prefix you want to set',
                            type: 3,
                            required: true,
                        },
                    ],
                },
                {
                    name: 'reset',
                    description: 'Resets the prefix to the default one',
                    type: 1,
                },
            ],
        });
    }
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<any> {
        const guildId = ctx.guild?.id;
        if (!guildId) return;
        const embed = client.embed().setColor(client.color.main);
        let guild = await client.db.get(guildId);

        let subCommand: string;
        let pre: string | undefined;
        if (ctx.isInteraction) {
            const interaction = ctx.interaction;
            if (!interaction) return;
            subCommand = interaction.options.data[0].name;
            pre = interaction.options.data[0].options?.[0]?.value?.toString();
        } else {
            subCommand = args[0];
            pre = args[1];
        }
        switch (subCommand) {
            case 'set':
                if (!pre) {
                    embed.setDescription(
                        `The prefix for this server is \`${guild ? guild.prefix : client.config.prefix
                        }\``
                    );
                    return await ctx.sendMessage({ embeds: [embed] });
                }
                if (pre.length > 3)
                    return await ctx.sendMessage({
                        embeds: [
                            embed.setDescription(`The prefix can't be longer than 3 characters`),
                        ],
                    });

                if (!guild) {
                    client.db.setPrefix(guildId, pre);
                    return await ctx.sendMessage({
                        embeds: [
                            embed.setDescription(`The prefix for this server is now \`${pre}\``),
                        ],
                    });
                } else {
                    client.db.setPrefix(guildId, pre);
                    return await ctx.sendMessage({
                        embeds: [
                            embed.setDescription(`The prefix for this server is now \`${pre}\``),
                        ],
                    });
                }
            case 'reset':
                if (!guild)
                    return await ctx.sendMessage({
                        embeds: [
                            embed.setDescription(
                                `The prefix for this server is \`${client.config.prefix}\``
                            ),
                        ],
                    });
                client.db.setPrefix(guildId, client.config.prefix);
                return await ctx.sendMessage({
                    embeds: [
                        embed.setDescription(
                            `The prefix for this server is now \`${client.config.prefix}\``
                        ),
                    ],
                });
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
