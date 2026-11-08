import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'pause',
    description: { content: 'Pauses the current song', examples: ['pause'], usage: 'pause' },
    aliases: [],
    dj: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (player.paused) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('The song is already paused')],
            });
        }
        player.pause();
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription('Paused the song')],
        });
    },
});
