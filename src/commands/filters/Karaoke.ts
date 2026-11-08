import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'karaoke',
    description: { content: 'on/off the karaoke filter', examples: ['karaoke'], usage: 'karaoke' },
    aliases: ['kk'],
    run: toggleFilter(
        'karaoke',
        'Karaoke',
        player =>
            player.player.setKaraoke({ level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }),
        player => player.player.setKaraoke()
    ),
});
