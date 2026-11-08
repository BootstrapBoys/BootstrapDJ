import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'leave',
    description: { content: 'Leaves the voice channel', examples: ['leave'], usage: 'leave' },
    aliases: ['dc'],
    active: false,
    requirePlayer: false,
    run: async ({ client, ctx, player }) => {
        if (!ctx.guild) return;
        if (!player) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('I\'m not in a voice channel')],
            });
        }
        await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Left <#${player.node.manager.connections.get(ctx.guild.id)?.channelId}>`),
            ],
        });
        player.destroy();
    },
});
