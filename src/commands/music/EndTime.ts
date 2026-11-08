import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { parseTime } from '../../lib/QueueTools.js';

export default class EndTime extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'endtime',
            description: { content: 'Stops the current track at a given time', usage: 'endtime <time>', examples: ['endtime 2:30'] },
            category: 'music',
            aliases: ['sendtime', 'stopat'],
            cooldown: 3,
            args: true,
            player: { voice: true, dj: true, active: true, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                {
                    name: 'time',
                    description: 'Where to stop (30s, 1m, 02:30)',
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
        const end = parseTime(args.join(' '));
        if (!end && end !== 0) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Give a time like `30s` or `02:30`.')],
            });
        }
        const duration = player.current.info.length;
        const target = duration > 0 ? Math.min(duration, end) : end;
        const position = player.player.position;
        if (target <= position) {
            await player.skip();
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.main).setDescription('Skipped to the end point.')],
            });
        }
        const timer = setTimeout(() => {
            void player.skip();
        }, target - position);
        timer.unref();
        player.player.once('end', () => clearTimeout(timer));
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Will stop at ${client.utils.formatTime(target)}.`),
            ],
        });
    }
}
