import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'skipto',
    description: { content: 'Skips to a specific song in the queue', examples: ['skipto 3'], usage: 'skipto <number>' },
    aliases: ['st'],
    args: true,
    options: [
        {
            name: 'number',
            description: 'The number of the song you want to skip to',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        if (!player) return;
        const target = Number(args[0]);
        if (!player.queue.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('There are no songs in the queue.')],
            });
        }
        if (!Number.isInteger(target) || target < 1 || target > player.queue.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Please provide a valid number.')],
            });
        }
        player.skip(target);
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription(`Skipped to song number ${target}`)],
        });
    },
});
