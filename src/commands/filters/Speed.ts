import { ApplicationCommandOptionType } from 'discord.js';

import { defineFilterCommand } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'speed',
    description: { content: 'Sets the speed of the song', examples: ['speed 1.5'], usage: 'speed <number>' },
    aliases: ['speed'],
    args: true,
    options: [
        {
            name: 'speed',
            description: 'The speed you want to set',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        const speed = Number(args[0]);
        if (!Number.isFinite(speed)) {
            return await ctx.sendMessage({
                embeds: [{ description: 'Please provide a valid number', color: client.color.red }],
            });
        }
        if (speed < 0.5 || speed > 5) {
            return await ctx.sendMessage({
                embeds: [{ description: 'Please provide a number between 0.5 and 5', color: client.color.red }],
            });
        }
        player.player.setTimescale({ speed });
        if (!player.filters.includes('speed')) player.filters.push('speed');
        player.filterValues.speed = speed;
        return await ctx.sendMessage({
            embeds: [{ description: `Speed has been set to ${speed}`, color: client.color.main }],
        });
    },
});
