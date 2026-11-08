import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'shuffle',
    description: { content: 'Shuffles the queue', examples: ['shuffle'], usage: 'shuffle' },
    aliases: ['sh'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.queue.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('There are no songs in the queue.')],
            });
        }
        player.setShuffle();
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription('Shuffled the queue')],
        });
    },
});
