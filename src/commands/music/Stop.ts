import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'stop',
    description: {
        content: 'Stops the music and clears the queue',
        examples: ['stop'],
        usage: 'stop',
    },
    aliases: ['sp'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        player.queue = [];
        player.stop();
        return await replyOk(client, ctx, 'Stopped the music and cleared the queue');
    },
});
