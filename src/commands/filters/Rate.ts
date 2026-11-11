import { ApplicationCommandOptionType } from 'discord.js';

import { defineFilterCommand, numericFilter } from '../../lib/filterCommand.js';
import { tr } from '../../lib/i18nContext.js';

export default defineFilterCommand({
    name: 'rate',
    description: {
        content: 'Changes the playback rate (speed and pitch)',
        usage: 'rate <0.5-5>',
        examples: ['rate 1.25'],
    },
    aliases: ['playbackrate'],
    args: true,
    // The live track is the target, so an idle player is not enough.
    requireCurrent: true,
    missingPlayer: ctx => tr(ctx, 'longtail:filters.nothingPlaying'),
    options: [
        {
            name: 'rate',
            description: 'Rate multiplier between 0.5 and 5',
            type: ApplicationCommandOptionType.Number,
            required: true,
            minValue: 0.5,
            maxValue: 5,
        },
    ],
    run: numericFilter({
        key: 'rate',
        min: 0.5,
        max: 5,
        invalid: ctx => tr(ctx, 'longtail:filters.rateRange'),
        outOfRange: ctx => tr(ctx, 'longtail:filters.rateRange'),
        apply: (player, rate) => player.player.setTimescale({ rate, pitch: rate, speed: 1 }),
        success: (rate, ctx) => tr(ctx, 'longtail:filters.rateSet', { rate }),
    }),
});
