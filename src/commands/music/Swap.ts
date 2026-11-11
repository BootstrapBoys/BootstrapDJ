import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Swap extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'swap',
            description: {
                content: 'Swaps two queued tracks',
                usage: 'swap <first> <second>',
                examples: ['swap 1 3'],
            },
            category: 'music',
            aliases: ['swapqueue'],
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
                    name: 'first',
                    description: 'First queue position (1-based)',
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    minValue: 1,
                },
                {
                    name: 'second',
                    description: 'Second queue position (1-based)',
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    minValue: 1,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player?.current || player.queue.length < 2) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.swapTooFew')),
                ],
            });
        }
        const first = Number(args[0]);
        const second = Number(args[1]);
        if (
            !Number.isInteger(first) ||
            !Number.isInteger(second) ||
            first < 1 ||
            second < 1 ||
            first > player.queue.length ||
            second > player.queue.length
        ) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(
                            tr(ctx, 'longtail:music.swapRange', { max: player.queue.length })
                        ),
                ],
            });
        }
        const a = first - 1;
        const b = second - 1;
        [player.queue[a], player.queue[b]] = [player.queue[b], player.queue[a]];
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(tr(ctx, 'longtail:music.swapDone', { first, second })),
            ],
        });
    }
}
