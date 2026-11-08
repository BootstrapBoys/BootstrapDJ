import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'join',
    description: { content: 'Joins the voice channel', examples: ['join'], usage: 'join' },
    aliases: ['j'],
    dj: false,
    active: false,
    requirePlayer: false,
    run: async ({ client, ctx, player }) => {
        const guild = ctx.guild;
        if (!guild) return;

        if (player && !player.isStale) {
            const channelId = player.node.manager.connections.get(guild.id)?.channelId;
            return await replyOk(client, ctx, `I'm already connected to <#${channelId}>`);
        }

        const created = await client.queue.create(
            guild,
            ctx.voiceChannel,
            ctx.channel,
            client.shoukaku.options.nodeResolver(client.shoukaku.nodes)
        );
        const channelId = created.node.manager.connections.get(guild.id)?.channelId;
        return await replyOk(client, ctx, `Joined <#${channelId}>`);
    },
});
