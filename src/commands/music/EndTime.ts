import { ApplicationCommandOptionType } from 'discord.js';
import type { Player } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { parseTime } from '../../lib/QueueTools.js';

interface PendingEndTime {
    timer: NodeJS.Timeout;
    player: Player;
    listener: () => void;
}

/** One pending stop-at per guild; a new /endtime replaces the old one. */
const pending = new Map<string, PendingEndTime>();

/** Drop the guild's pending stop-at timer and its player listener. */
export function cancelEndTime(guildId: string): void {
    const entry = pending.get(guildId);
    if (!entry) return;
    pending.delete(guildId);
    clearTimeout(entry.timer);
    entry.player.off('end', entry.listener);
}

/** Arm the single stop-at timer; a prior timer/listener is always removed. */
export function scheduleEndTime(
    guildId: string,
    player: Player,
    delayMs: number,
    onElapsed: () => void
): void {
    cancelEndTime(guildId);
    const listener = (): void => {
        clearTimeout(timer);
        pending.delete(guildId);
    };
    const timer = setTimeout(
        () => {
            pending.delete(guildId);
            player.off('end', listener);
            onElapsed();
        },
        Math.max(0, delayMs)
    );
    timer.unref();
    player.once('end', listener);
    pending.set(guildId, { timer, player, listener });
}

export default class EndTime extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'endtime',
            description: {
                content: 'Stops the current track at a given time',
                usage: 'endtime <time>',
                examples: ['endtime 2:30'],
            },
            category: 'music',
            aliases: ['sendtime', 'stopat'],
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
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('Nothing is playing right now.'),
                ],
            });
        }
        const end = parseTime(args.join(' '));
        if (!end && end !== 0) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('Give a time like `30s` or `02:30`.'),
                ],
            });
        }
        const duration = player.current.info.length;
        const target = duration > 0 ? Math.min(duration, end) : end;
        const position = player.player.position;
        if (target <= position) {
            // Any accepted /endtime replaces the previous stop-at, including
            // the immediate-skip branch.
            cancelEndTime(guild.id);
            await player.skip();
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription('Skipped to the end point.'),
                ],
            });
        }
        scheduleEndTime(guild.id, player.player, target - position, () => {
            void player.skip();
        });
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
