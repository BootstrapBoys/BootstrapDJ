import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'skipto',
    description: {
        content: 'Skips to a specific song in the queue',
        examples: ['skipto 3'],
        usage: 'skipto <number>',
    },
    aliases: ['st'],
    args: true,
    options: [
        {
            name: 'number',
            description: 'The number of the song you want to skip to',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        if (!player) return;
        if (!player.queue.length)
            return await replyFail(client, ctx, 'There are no songs in the queue.');

        const target = Number(args[0]);
        const valid = Number.isInteger(target) && target >= 1 && target <= player.queue.length;
        if (!valid) return await replyFail(client, ctx, 'Please provide a valid number.');

        player.skip(target);
        return await replyOk(client, ctx, `Skipped to song number ${target}`);
    },
});
