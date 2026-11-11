import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'resume',
    description: { content: 'Resumes the current song', examples: ['resume'], usage: 'resume' },
    aliases: ['r'],
    dj: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.paused) return await replyFail(client, ctx, tr(ctx, 'commands:core.notPaused'));

        player.pause();
        return await replyOk(client, ctx, tr(ctx, 'commands:core.resumed'));
    },
});
