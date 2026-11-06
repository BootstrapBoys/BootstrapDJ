import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Speed extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'speed',
            description: {
                content: 'Sets the speed of the song',
                examples: ['speed 1.5'],
                usage: 'speed <number>',
            },
            category: 'filters',
            aliases: ['speed'],
            cooldown: 3,
            args: true,
            player: {
                voice: true,
                dj: true,
                active: true,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: false,
            options: [
                {
                    name: 'speed',
                    description: 'The speed you want to set',
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                },
            ],
        });
    }
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        if (!ctx.guild) return await ctx.sendMessage({ content: 'This command only works in a server.' });
        const player = client.queue.get(ctx.guild.id);
        if (!player)
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.red)
                        .setDescription('There is no music playing in this server.'),
                ],
            });
        const speed = Number(args[0]);

        if (isNaN(speed))
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'Please provide a valid number',
                        color: client.color.red,
                    },
                ],
            });

        if (speed < 0.5 || speed > 5)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'Please provide a number between 0.5 and 5',
                        color: client.color.red,
                    },
                ],
            });

        player.player.setTimescale({ speed });
        if (!player.filters.includes('speed')) player.filters.push('speed');
        player.filterValues.speed = speed;

        return await ctx.sendMessage({
            embeds: [
                {
                    description: `Speed has been set to ${speed}`,
                    color: client.color.main,
                },
            ],
        });
    }
}
