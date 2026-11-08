import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'remove',
    description: { content: 'Removes a song from the queue', examples: ['remove 1'], usage: 'remove <song number>' },
    aliases: ['rm'],
    args: true,
    options: [
        {
            name: 'song',
            description: 'The song number',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        if (!player) return;
        const index = Number(args[0]);
        if (!player.queue.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('There are no songs in the queue.')],
            });
        }
        if (!Number.isInteger(index) || index < 1 || index > player.queue.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('That is not a valid number.')],
            });
        }
        player.remove(index - 1);
        return await ctx.sendMessage({
            embeds: [
                client.embed().setColor(client.color.main).setDescription(`Removed song number ${index} from the queue`),
            ],
        });
    },
});
