import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Faq extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'faq',
            description: { content: 'Common BootstrapDJ usage questions', usage: 'faq', examples: ['faq'] },
            category: 'info',
            aliases: ['howtouse'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
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
                    .setTitle('BootstrapDJ FAQ')
                    .setDescription(
                        [
                            '**How do I start playing music?**',
                            'Join a voice channel and use `/play <song or URL>`.',
                            '',
                            '**How do I see the queue?**',
                            'Use `/queue` (public) or `/queueinfo` for totals.',
                            '',
                            '**How do I change volume?**',
                            'Use `/volume <0-200>`.',
                            '',
                            '**Why did a track stop?**',
                            'Check `/nodestatus` if playback failed; the bot fails over to its backup node when possible.',
                            '',
                            '**Are there premium commands?**',
                            'No. Every BootstrapDJ command is free.',
                        ].join('\n')
                    ),
            ],
        });
    }
}
