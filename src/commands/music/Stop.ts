import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'stop',
    description: { content: 'Stops the music and clears the queue', examples: ['stop'], usage: 'stop' },
    aliases: ['sp'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        player.queue = [];
        player.stop();
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription('Stopped the music and cleared the queue')],
        });
    },
});
