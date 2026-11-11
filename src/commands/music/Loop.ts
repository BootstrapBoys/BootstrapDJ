import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyOk } from '../../lib/reply.js';

const NEXT_LOOP = { off: 'repeat', repeat: 'queue', queue: 'off' } as const;

const LOOP_COPY: Record<string, string> = {
    repeat: 'commands:core.loopSong',
    queue: 'commands:core.loopQueue',
    off: 'commands:core.loopOff',
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
        return await replyOk(client, ctx, tr(ctx, LOOP_COPY[player.loop]));
    },
});
