import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'join',
    description: { content: 'Joins the voice channel', examples: ['join'], usage: 'join' },
    aliases: ['j'],
    dj: false,
    active: false,
    requirePlayer: false,
    run: async ({ client, ctx, player }) => {
        if (!ctx.guild) return;
        if (!player || player.isStale) {
            const created = await client.queue.create(
                ctx.guild,
                ctx.voiceChannel,
                ctx.channel,
                client.shoukaku.options.nodeResolver(client.shoukaku.nodes)
            );
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(`Joined <#${created.node.manager.connections.get(ctx.guild.id)?.channelId}>`),
                ],
            });
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        `I'm already connected to <#${player.node.manager.connections.get(ctx.guild.id)?.channelId}>`
                    ),
            ],
        });
    },
});
