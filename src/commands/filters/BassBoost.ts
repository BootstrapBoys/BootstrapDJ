import { defineFilterCommand, toggleFilter } from '../../lib/filterCommand.js';

const BASS_BANDS = [
    { band: 0, gain: 0.34 },
    { band: 1, gain: 0.34 },
    { band: 2, gain: 0.34 },
    { band: 3, gain: 0.34 },
];

export default defineFilterCommand({
    name: 'bassboost',
    description: { content: 'on/off bassboost filter', examples: ['bassboost'], usage: 'bassboost' },
    aliases: ['bb'],
    run: toggleFilter(
        'bassboost',
        'Bassboost',
        player => player.player.setEqualizer(BASS_BANDS),
        player => player.player.setEqualizer([])
    ),
});
