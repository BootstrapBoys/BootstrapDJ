import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { parseTime } from '../../lib/QueueTools.js';

export default class Forward extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'forward',
            description: { content: 'Winds the current track forward', usage: 'forward <time>', examples: ['forward 30s', 'forward 01:30'] },
            category: 'music',
            aliases: ['fw', 'forwards'],
            cooldown: 3,
            args: true,
            player: { voice: true, dj: false, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'time',
                    description: 'Amount to move forward (30s, 1m, 01:30)',
                    type: ApplicationCommandOptionType.String,
                    required: true,
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
        const ms = parseTime(args.join(' '));
        if (!ms) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Give a time like `30s` or `01:30`.')],
            });
        }
        const duration = player.current.info.length;
        const position =
            duration > 0 ? Math.min(duration, player.player.position + ms) : player.player.position + ms;
        player.seek(position);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Moved forward to ${client.utils.formatTime(position)}.`),
            ],
        });
    }
}
