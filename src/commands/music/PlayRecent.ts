import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class PlayRecent extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playrecent',
            description: { content: 'Queues tracks from recent playback history', usage: 'playrecent [count]', examples: ['playrecent 5'] },
            category: 'music',
            aliases: ['pr'],
            cooldown: 3,
            args: false,
            defer: true,
            player: { voice: true, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'count',
                    description: 'How many recent tracks to queue (1-20)',
                    type: ApplicationCommandOptionType.Integer,
                    required: false,
                    minValue: 1,
                    maxValue: 20,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        let player = client.queue.get(guild.id);
        const vc = ctx.voiceChannel;
        if (!player || player.isStale) player = await client.queue.create(guild, vc, ctx.channel);
        const count = Math.min(20, Math.max(1, Number(args[0]) || 5));
        const recent = player.history.slice(-count);
        if (!recent.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('No playback history yet.')],
            });
        }
        for (const track of recent) player.enqueue(track);
        await player.isPlaying();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Queued ${recent.length} recent track${recent.length === 1 ? '' : 's'}.`),
            ],
        });
    }
}
