import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'resume',
    description: { content: 'Resumes the current song', examples: ['resume'], usage: 'resume' },
    aliases: ['r'],
    dj: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.paused) return await replyFail(client, ctx, 'The player is not paused.');

        player.pause();
        return await replyOk(client, ctx, 'Resumed the player');
    },
});
