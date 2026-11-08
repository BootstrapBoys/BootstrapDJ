import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'shuffle',
    description: { content: 'Shuffles the queue', examples: ['shuffle'], usage: 'shuffle' },
    aliases: ['sh'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.queue.length) return await replyFail(client, ctx, 'There are no songs in the queue.');

        player.setShuffle();
        return await replyOk(client, ctx, 'Shuffled the queue');
    },
});
