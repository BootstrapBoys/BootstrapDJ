import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'shuffle',
    description: { content: 'Shuffles the queue', examples: ['shuffle'], usage: 'shuffle' },
    aliases: ['sh'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.queue.length)
            return await replyFail(client, ctx, tr(ctx, 'commands:core.noQueue'));

        player.setShuffle();
        return await replyOk(client, ctx, tr(ctx, 'commands:core.shuffled'));
    },
});
