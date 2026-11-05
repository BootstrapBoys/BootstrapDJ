import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { parseTime } from '../../utils/QueueTools.js';

export default class StartTime extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'starttime',
            description: { content: 'Starts the current track from a given time', usage: 'starttime <time>', examples: ['starttime 1:20'] },
            category: 'music',
            aliases: ['startat'],
            cooldown: 3,
            args: true,
            player: { voice: true, dj: true, active: true, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                {
                    name: 'time',
                    description: 'Playback start time (30s, 1m, 01:30)',
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
        if (!ms && ms !== 0) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Give a time like `30s` or `01:30`.')],
            });
        }
        const duration = player.current.info.length;
        const position = duration > 0 ? Math.min(duration, ms) : ms;
        player.seek(position);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Playback will start at ${client.utils.formatTime(position)}.`),
            ],
        });
    }
}
