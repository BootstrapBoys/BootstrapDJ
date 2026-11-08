import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'rotation',
    description: { content: 'on/off rotation filter', examples: ['rotation'], usage: 'rotation' },
    aliases: ['rt'],
    run: toggleFilter(
        'rotation',
        'rotation',
        player => player.player.setRotation({ rotationHz: 0.2 }),
        player => player.player.setRotation()
    ),
});
