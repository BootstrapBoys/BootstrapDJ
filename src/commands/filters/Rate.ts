import { ApplicationCommandOptionType } from 'discord.js';

import { defineFilterCommand, numericFilter } from '../../lib/filterCommand.js';

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
    missingPlayer: 'Nothing is playing right now.',
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
        invalid: 'Rate must be between 0.5 and 5.',
        outOfRange: 'Rate must be between 0.5 and 5.',
        apply: (player, rate) => player.player.setTimescale({ rate, pitch: rate, speed: 1 }),
        success: rate => `Playback rate set to **${rate}x**.`,
    }),
});
