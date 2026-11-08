import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyOk } from '../../lib/reply.js';

const NEXT_LOOP = { off: 'repeat', repeat: 'queue', queue: 'off' } as const;

const LOOP_COPY: Record<string, string> = {
    repeat: '**Looping the song**',
    queue: '**Looping the queue**',
    off: '**Looping is now off**',
};

export default defineMusicCommand({
    name: 'loop',
    description: {
        content: 'loop the current song or the queue',
        examples: ['loop', 'loop queue', 'loop song'],
        usage: 'loop',
    },
    aliases: ['loop'],
    dj: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        player.setLoop(NEXT_LOOP[player.loop]);
        return await replyOk(client, ctx, LOOP_COPY[player.loop]);
    },
});
