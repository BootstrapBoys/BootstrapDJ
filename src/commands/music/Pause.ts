import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'pause',
    description: { content: 'Pauses the current song', examples: ['pause'], usage: 'pause' },
    aliases: [],
    dj: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (player.paused)
            return await replyFail(client, ctx, tr(ctx, 'commands:core.alreadyPaused'));

        player.pause();
        return await replyOk(client, ctx, tr(ctx, 'commands:core.paused'));
    },
});
