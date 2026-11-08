import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'lowpass',
    description: { content: 'on/off lowpass filter', examples: ['lowpass'], usage: 'lowpass <number>' },
    aliases: ['lp'],
    run: toggleFilter(
        'lowpass',
        'Lowpass',
        player => player.player.setLowPass({ smoothing: 20 }),
        player => player.player.setLowPass({})
    ),
});
