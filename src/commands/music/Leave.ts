import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'leave',
    description: { content: 'Leaves the voice channel', examples: ['leave'], usage: 'leave' },
    aliases: ['dc'],
    active: false,
    requirePlayer: false,
    run: async ({ client, ctx, player }) => {
        const guild = ctx.guild;
        if (!guild) return;
        if (!player) return await replyFail(client, ctx, 'I\'m not in a voice channel');

        const channelId = player.node.manager.connections.get(guild.id)?.channelId;
        await replyOk(client, ctx, `Left <#${channelId}>`);
        player.destroy();
    },
});
