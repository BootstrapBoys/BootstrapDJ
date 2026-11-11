import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'clearqueue',
    description: { content: 'Clears the queue', examples: ['clearqueue'], usage: 'clearqueue' },
    aliases: ['cq', 'clear'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.queue.length)
            return await replyFail(client, ctx, tr(ctx, 'commands:core.noQueue'));

        player.clearQueue();
        return await replyOk(client, ctx, tr(ctx, 'commands:core.cleared'));
    },
});
