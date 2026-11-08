import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { parseTime } from '../../lib/QueueTools.js';

export default defineMusicCommand({
    name: 'seek',
    description: { content: 'Seeks to a certain time in the song', examples: ['seek 1m, seek 1h 30m'], usage: 'seek <time>' },
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
        if (time === null) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Invalid time format.')],
            });
        }
        player.seek(time);
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription(`Seeked to ${args[0]}`)],
        });
    },
});
