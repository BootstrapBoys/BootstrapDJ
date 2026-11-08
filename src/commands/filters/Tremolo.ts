import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'tremolo',
    description: { content: 'on/off the tremolo filter', examples: ['tremolo'], usage: 'tremolo' },
    aliases: ['tremolo'],
    run: toggleFilter(
        'tremolo',
        'tremolo',
        player => player.player.setTremolo({ depth: 0.75, frequency: 4 }),
        player => player.player.setTremolo()
    ),
});
