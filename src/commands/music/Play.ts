import { BootstrapClient, Command, Context } from '../../core/index.js';
import { runPlayRequest } from '../../lib/PlayRequest.js';

export default class Play extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'play',
            description: {
                content: 'Plays a song from YouTube or Spotify',
                examples: [
                    'play https://www.youtube.com/watch?v=QH2-TGUlwu4',
                    'play https://open.spotify.com/track/6WrI0LAC5M1Rw2MnX2ZvEg',
                ],
                usage: 'play <song>',
            },
            category: 'music',
            aliases: ['p'],
            cooldown: 3,
            args: true,
            player: {
                voice: true,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks', 'Connect', 'Speak'],
                user: [],
            },
            slashCommand: true,
            defer: true,
            options: [
                {
                    name: 'song',
                    description: 'The song you want to play',
                    type: 3,
                    required: true,
                    autocomplete: true,
                },
            ],
        });
    }
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        return await runPlayRequest(client, ctx, args, 'queue');
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
