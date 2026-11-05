import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class QueueInfo extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'queueinfo',
            description: { content: 'Shows queue totals and length', usage: 'queueinfo', examples: ['queueinfo'] },
            category: 'music',
            aliases: ['qi'],
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
        if (!player) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('No player is active.')],
            });
        }
        const total = player.queue.reduce((sum, track) => sum + (track.info.length || 0), 0);
        const current = player.current
            ? `**${player.current.info.title}** — ${player.current.info.author}`
            : 'Nothing';
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Queue information')
                    .addFields(
                        { name: 'Current', value: current, inline: false },
                        { name: 'Queued tracks', value: String(player.queue.length), inline: true },
                        { name: 'Queue length', value: client.utils.formatTime(total), inline: true },
                        { name: 'Autoplay', value: player.autoplay ? 'on' : 'off', inline: true },
                        { name: 'Loop', value: player.loop, inline: true }
                    ),
            ],
        });
    }
}
