import { ApplicationCommandOptionType } from 'discord.js';

import { defineFilterCommand, numericFilter } from '../../lib/filterCommand.js';

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
        invalid: 'Please provide a valid number',
        outOfRange: 'Please provide a number between 0.5 and 5',
        apply: (player, speed) => player.player.setTimescale({ speed }),
        success: speed => `Speed has been set to ${speed}`,
    }),
});
