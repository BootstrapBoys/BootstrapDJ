import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Rate extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'rate',
            description: { content: 'Changes the playback rate (speed and pitch)', usage: 'rate <0.5-5>', examples: ['rate 1.25'] },
            category: 'filters',
            aliases: ['playbackrate'],
            cooldown: 3,
            args: true,
            player: { voice: true, dj: true, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'rate',
                    description: 'Rate multiplier between 0.5 and 5',
                    type: ApplicationCommandOptionType.Number,
                    required: true,
                    minValue: 0.5,
                    maxValue: 5,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing is playing right now.')],
            });
        }
        const rate = Number(args[0]);
        if (!Number.isFinite(rate) || rate < 0.5 || rate > 5) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Rate must be between 0.5 and 5.')],
            });
        }
        player.player.setTimescale({ rate, pitch: rate, speed: 1 });
        if (!player.filters.includes('rate')) player.filters.push('rate');
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Playback rate set to **${rate}x**.`),
            ],
        });
    }
}
