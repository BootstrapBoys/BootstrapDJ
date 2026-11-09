import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Support extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'support',
            description: {
                content: 'How to get help with BootstrapDJ',
                usage: 'support',
                examples: ['support'],
            },
            category: 'info',
            aliases: ['helpme'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('BootstrapDJ support')
                    .setDescription(
                        [
                            'Use `/help <command>` for usage details and `/faq` for common questions.',
                            '',
                            'For bugs or feature requests, open an issue on the BootstrapDJ repository:',
                            'https://github.com/BootstrapBoys/BootstrapDJ/issues',
                            '',
                            'No support tier or paid priority queue exists.',
                        ].join('\n')
                    ),
            ],
        });
    }
}
