import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Pitch extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'pitch',
            description: {
                content: 'on/off the pitch filter',
                examples: ['pitch 1'],
                usage: 'pitch <number>',
            },
            category: 'filters',
            aliases: ['ph'],
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
                    name: 'number',
                    description: 'The number you want to set the pitch to',
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

        const number = Number(args[0]);
        if (isNaN(number))
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'Please provide a valid number',
                        color: client.color.red,
                    },
                ],
            });
        if (number > 5 || number < 1)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'Please provide a number between 1 and 5',
                        color: client.color.red,
                    },
                ],
            });
        player.player.setTimescale({ pitch: number, rate: 1, speed: 1 });
        if (!player.filters.includes('pitch')) player.filters.push('pitch');
        player.filterValues.pitch = number;

        return await ctx.sendMessage({
            embeds: [
                {
                    description: `Pitch has been set to ${number}`,
                    color: client.color.main,
                },
            ],
        });
    }
}
