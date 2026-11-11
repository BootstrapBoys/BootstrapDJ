import { ApplicationCommandOptionType } from 'discord.js';

import { defineFilterCommand, numericFilter } from '../../lib/filterCommand.js';
import { tr } from '../../lib/i18nContext.js';

export default defineFilterCommand({
    name: 'pitch',
    description: {
        content: 'on/off the pitch filter',
        examples: ['pitch 1'],
        usage: 'pitch <number>',
    },
    aliases: ['ph'],
    args: true,
    options: [
        {
            name: 'number',
            description: 'The number you want to set the pitch to',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: numericFilter({
        key: 'pitch',
        min: 1,
        max: 5,
        invalid: ctx => tr(ctx, 'longtail:filters.invalidNumber'),
        outOfRange: ctx => tr(ctx, 'longtail:filters.pitchRange'),
        apply: (player, pitch) => player.player.setTimescale({ pitch, rate: 1, speed: 1 }),
        success: (pitch, ctx) => tr(ctx, 'longtail:filters.pitchSet', { pitch }),
    }),
});
