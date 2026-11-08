import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { runPlayRequest } from '../../lib/PlayRequest.js';

export default defineMusicCommand({
    name: 'play',
    description: {
        content: 'Plays a song from YouTube or Spotify',
        examples: ['play https://www.youtube.com/watch?v=QH2-TGUlwu4', 'play https://open.spotify.com/track/6WrI0LAC5M1Rw2MnX2ZvEg'],
        usage: 'play <song>',
    },
    aliases: ['p'],
    args: true,
    dj: false,
    active: false,
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
    run: async ({ client, ctx, args }) => await runPlayRequest(client, ctx, args, 'queue'),
});
