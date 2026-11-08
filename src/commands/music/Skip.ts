import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'skip',
    description: { content: 'Skips the current song', examples: ['skip'], usage: 'skip' },
    aliases: ['sk'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.queue.length)
            return await replyFail(client, ctx, 'There are no songs in the queue.');

        player.skip();
        if (!ctx.isInteraction) {
            void ctx.message?.react('👍').catch(() => {});
            return;
        }

        const current = player.current;
        if (!current) return await replyFail(client, ctx, 'Nothing playing right now');
        return await replyOk(client, ctx, `Skipped [${current.info.title}](${current.info.uri})`);
    },
});
