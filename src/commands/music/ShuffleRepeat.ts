import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class ShuffleRepeat extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'shufflerepeat',
            description: {
                content: 'Shuffles the queue and enables queue repeat',
                usage: 'shufflerepeat',
                examples: ['shufflerepeat'],
            },
            category: 'music',
            aliases: ['shuffleloop'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: true, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('Nothing is playing right now.'),
                ],
            });
        }
        player.setShuffle();
        player.setLoop('queue');
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription('Shuffled the queue and enabled queue repeat.'),
            ],
        });
    }
}
