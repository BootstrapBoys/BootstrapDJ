import { defineMusicCommand } from '../../lib/musicCommand.js';

const NEXT_LOOP = { off: 'repeat', repeat: 'queue', queue: 'off' } as const;

export default defineMusicCommand({
    name: 'loop',
    description: { content: 'loop the current song or the queue', examples: ['loop', 'loop queue', 'loop song'], usage: 'loop' },
    aliases: ['loop'],
    dj: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        player.loop = NEXT_LOOP[player.loop];
        const copy =
            player.loop === 'repeat'
                ? '**Looping the song**'
                : player.loop === 'queue'
                  ? '**Looping the queue**'
                  : '**Looping is now off**';
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription(copy)],
        });
    },
});
