import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { runPlayRequest } from '../../lib/PlayRequest.js';

export default defineMusicCommand({
    name: 'playnext',
    description: {
        content: 'Add the song to play next in queue',
        examples: ['playnext https://www.youtube.com/watch?v=QH2-TGUlwu4', 'playnext https://open.spotify.com/track/6WrI0LAC5M1Rw2MnX2ZvEg'],
        usage: 'playnext <song>',
    },
    aliases: ['pn'],
    args: true,
    dj: false,
    active: false,
    requirePlayer: false,
    defer: true,
    clientPermissions: ['SendMessages', 'ViewChannel', 'EmbedLinks', 'Connect', 'Speak'],
    options: [
        {
            name: 'song',
            description: 'The song you want to play',
            type: ApplicationCommandOptionType.String,
            required: true,
            autocomplete: true,
        },
    ],
    run: async ({ client, ctx, args }) => await runPlayRequest(client, ctx, args, 'next'),
});
