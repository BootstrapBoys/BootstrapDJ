import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'pause',
    description: { content: 'Pauses the current song', examples: ['pause'], usage: 'pause' },
    aliases: [],
    dj: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (player.paused) return await replyFail(client, ctx, 'The song is already paused');

        player.pause();
        return await replyOk(client, ctx, 'Paused the song');
    },
});
