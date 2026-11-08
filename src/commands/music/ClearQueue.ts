import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'clearqueue',
    description: { content: 'Clears the queue', examples: ['clearqueue'], usage: 'clearqueue' },
    aliases: ['cq', 'clear'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.queue.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('There are no songs in the queue.')],
            });
        }
        player.queue = [];
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription('Cleared the queue')],
        });
    },
});
