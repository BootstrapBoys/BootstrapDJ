import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'remove',
    description: {
        content: 'Removes a song from the queue',
        examples: ['remove 1'],
        usage: 'remove <song number>',
    },
    aliases: ['rm'],
    args: true,
    options: [
        {
            name: 'song',
            description: 'The song number',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        if (!player) return;
        if (!player.queue.length)
            return await replyFail(client, ctx, 'There are no songs in the queue.');

        const position = Number(args[0]);
        const valid =
            Number.isInteger(position) && position >= 1 && position <= player.queue.length;
        if (!valid) return await replyFail(client, ctx, 'That is not a valid number.');

        player.remove(position - 1);
        return await replyOk(client, ctx, `Removed song number ${position} from the queue`);
    },
});
