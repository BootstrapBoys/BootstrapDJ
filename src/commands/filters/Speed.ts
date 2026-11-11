import { ApplicationCommandOptionType } from 'discord.js';

import { defineFilterCommand, numericFilter } from '../../lib/filterCommand.js';
import { tr } from '../../lib/i18nContext.js';

export default defineFilterCommand({
    name: 'speed',
    description: {
        content: 'Sets the speed of the song',
        examples: ['speed 1.5'],
        usage: 'speed <number>',
    },
    aliases: ['speed'],
    args: true,
    options: [
        {
            name: 'speed',
            description: 'The speed you want to set',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: numericFilter({
        key: 'speed',
        min: 0.5,
        max: 5,
        invalid: ctx => tr(ctx, 'longtail:filters.invalidNumber'),
        outOfRange: ctx => tr(ctx, 'longtail:filters.speedRange'),
        apply: (player, speed) => player.player.setTimescale({ speed }),
        success: (speed, ctx) => tr(ctx, 'longtail:filters.speedSet', { speed }),
    }),
});
