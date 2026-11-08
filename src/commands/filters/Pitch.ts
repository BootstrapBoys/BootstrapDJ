import { ApplicationCommandOptionType } from 'discord.js';

import { defineFilterCommand } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'pitch',
    description: { content: 'on/off the pitch filter', examples: ['pitch 1'], usage: 'pitch <number>' },
    aliases: ['ph'],
    args: true,
    options: [
        {
            name: 'number',
            description: 'The number you want to set the pitch to',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        const pitch = Number(args[0]);
        if (!Number.isFinite(pitch)) {
            return await ctx.sendMessage({
                embeds: [{ description: 'Please provide a valid number', color: client.color.red }],
            });
        }
        if (pitch < 1 || pitch > 5) {
            return await ctx.sendMessage({
                embeds: [{ description: 'Please provide a number between 1 and 5', color: client.color.red }],
            });
        }
        player.player.setTimescale({ pitch, rate: 1, speed: 1 });
        if (!player.filters.includes('pitch')) player.filters.push('pitch');
        player.filterValues.pitch = pitch;
        return await ctx.sendMessage({
            embeds: [{ description: `Pitch has been set to ${pitch}`, color: client.color.main }],
        });
    },
});
