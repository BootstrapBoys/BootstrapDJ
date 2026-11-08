import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'clearqueue',
    description: { content: 'Clears the queue', examples: ['clearqueue'], usage: 'clearqueue' },
    aliases: ['cq', 'clear'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.queue.length)
            return await replyFail(client, ctx, 'There are no songs in the queue.');

        player.clearQueue();
        return await replyOk(client, ctx, 'Cleared the queue');
    },
});
