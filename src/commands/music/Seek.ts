import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { parseTime } from '../../lib/QueueTools.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'seek',
    description: {
        content: 'Seeks to a certain time in the song',
        examples: ['seek 1m, seek 1h 30m'],
        usage: 'seek <time>',
    },
    aliases: ['se', 'windto', 'seekto'],
    args: true,
    dj: false,
    options: [
        {
            name: 'time',
            description: 'The time to seek to',
            type: ApplicationCommandOptionType.String,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        if (!player) return;

        const time = parseTime(args.join(' '));
        if (time === null)
            return await replyFail(client, ctx, tr(ctx, 'commands:core.invalidTime'));

        player.seek(time);
        return await replyOk(client, ctx, tr(ctx, 'commands:core.seeked', { time: args[0] }));
    },
});
