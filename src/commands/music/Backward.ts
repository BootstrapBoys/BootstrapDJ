import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { parseTime } from '../../utils/QueueTools.js';

export default class Backward extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'backward',
            description: { content: 'Winds the current track backward', usage: 'backward <time>', examples: ['backward 30s', 'backward 01:30'] },
            category: 'music',
            aliases: ['bw', 'backwards'],
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
                    description: 'Amount to move back (30s, 1m, 01:30)',
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
        const position = Math.max(0, player.player.position - ms);
        player.seek(position);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Moved back to ${client.utils.formatTime(position)}.`),
            ],
        });
    }
}
