import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'resume',
    description: { content: 'Resumes the current song', examples: ['resume'], usage: 'resume' },
    aliases: ['r'],
    dj: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.paused) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('The player is not paused.')],
            });
        }
        player.pause();
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription('Resumed the player')],
        });
    },
});
