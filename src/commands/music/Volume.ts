import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyFail, replyOk } from '../../lib/reply.js';

const MIN_VOLUME = 0;
const MAX_VOLUME = 200;

export default defineMusicCommand({
    name: 'volume',
    description: {
        content: 'Sets the volume of the player',
        examples: ['volume 100'],
        usage: 'volume <number>',
    },
    aliases: ['vol'],
    args: true,
    options: [
        {
            name: 'number',
            description: 'The volume you want to set',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        if (!player) return;

        const volume = Number(args[0]);
        if (!Number.isFinite(volume))
            return await replyFail(client, ctx, tr(ctx, 'commands:core.volumeInvalid'));
        if (volume < MIN_VOLUME) {
            return await replyFail(
                client,
                ctx,
                tr(ctx, 'commands:core.volumeLow', { min: MIN_VOLUME })
            );
        }
        if (volume > MAX_VOLUME) {
            return await replyFail(
                client,
                ctx,
                tr(ctx, 'commands:core.volumeHigh', { max: MAX_VOLUME })
            );
        }

        await player.player.setGlobalVolume(volume);
        if (ctx.guild) {
            await client.db.setGuildSetting(ctx.guild.id, 'defaultvolume', String(volume));
        }
        return await replyOk(client, ctx, tr(ctx, 'commands:core.volumeSet', { volume }));
    },
});
