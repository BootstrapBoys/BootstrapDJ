import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'distorsion',
    description: {
        content: 'on/off distorsion filter',
        examples: ['distorsion'],
        usage: 'distorsion',
    },
    aliases: ['distorsion'],
    run: toggleFilter(
        'distorsion',
        'Distorsion',
        player =>
            player.player.setDistortion({
                sinOffset: 0,
                sinScale: 1,
                cosOffset: 0,
                cosScale: 1,
                tanOffset: 0,
                tanScale: 1,
                offset: 0,
                scale: 1,
            }),
        player => player.player.setDistortion({})
    ),
});
