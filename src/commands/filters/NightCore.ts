import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'nightcore',
    description: { content: 'on/off nightcore filter', examples: ['nightcore'], usage: 'nightcore' },
    aliases: ['nc'],
    user: [],
    run: toggleFilter(
        'nightcore',
        'Nightcore',
        player => player.player.setTimescale({ speed: 1.165, pitch: 1.125, rate: 1.05 }),
        player => player.player.setTimescale()
    ),
});
