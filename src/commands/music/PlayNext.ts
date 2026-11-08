import { BootstrapClient, Command, Context } from '../../core/index.js';
import { runPlayRequest } from '../../lib/PlayRequest.js';

export default class PlayNext extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playnext',
            description: {
                content: 'Add the song to play next in queue',
                examples: [
                    'playnext https://www.youtube.com/watch?v=QH2-TGUlwu4',
                    'playnext https://open.spotify.com/track/6WrI0LAC5M1Rw2MnX2ZvEg',
                ],
                usage: 'playnext <song>',
            },
            category: 'music',
            aliases: ['pn'],
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
        return await runPlayRequest(client, ctx, args, 'next');
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
