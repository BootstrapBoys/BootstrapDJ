import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'vibrato',
    description: { content: 'on/off vibrato filter', examples: ['vibrato'], usage: 'vibrato' },
    aliases: ['vb'],
    user: [],
    run: toggleFilter(
        'vibrato',
        'Vibrato',
        player => player.player.setVibrato({ depth: 0.75, frequency: 4 }),
        player => player.player.setVibrato()
    ),
});
