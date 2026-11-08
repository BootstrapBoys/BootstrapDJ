import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class RecentlyPlayed extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'recentlyplayed',
            description: { content: 'Shows recently played tracks', usage: 'recentlyplayed', examples: ['recentlyplayed'] },
            category: 'music',
            aliases: ['history', 'rp'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
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
        const history = (player?.history ?? []).slice(-10).reverse();
        if (!history.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.main).setDescription('No playback history yet.')],
            });
        }
        const lines = history.map(
            (track, index) =>
                `**${index + 1}.** [${track.info.title}](${track.info.uri}) — ${track.info.author}`
        );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Recently played')
                    .setDescription(lines.join('\n').slice(0, 4096)),
            ],
        });
    }
}
