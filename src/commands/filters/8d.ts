import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: '8d',
    description: { content: 'on/off 8d filter', examples: ['8d'], usage: '8d' },
    aliases: ['3d'],
    user: [],
    missingPlayer: null,
    run: toggleFilter(
        '8D',
        '8D',
        player => player.player.setRotation({ rotationHz: 0.2 }),
        player => player.player.setRotation()
    ),
});
