import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class MassMove extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'massmove',
            description: {
                content: 'Moves a block of queued tracks',
                usage: 'massmove <from> <to> <destination>',
                examples: ['massmove 2 4 1'],
            },
            category: 'music',
            aliases: ['mm'],
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
                    name: 'from',
                    description: 'First position in the block (1-based)',
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    minValue: 1,
                },
                {
                    name: 'to',
                    description: 'Last position in the block (1-based)',
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    minValue: 1,
                },
                {
                    name: 'destination',
                    description: 'Insertion position in the resulting queue (1-based)',
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
                        .setDescription(tr(ctx, 'longtail:music.massMoveNeedsTwo')),
                ],
            });
        }
        const from = Number(args[0]);
        const to = Number(args[1]);
        const destination = Number(args[2]);
        if (
            !Number.isInteger(from) ||
            !Number.isInteger(to) ||
            !Number.isInteger(destination) ||
            from < 1 ||
            to < from ||
            to > player.queue.length ||
            destination < 1 ||
            destination > player.queue.length
        ) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(
                            tr(ctx, 'longtail:music.massMoveInvalidPositions', {
                                max: player.queue.length,
                            })
                        ),
                ],
            });
        }
        const block = player.queue.splice(from - 1, to - from + 1);
        const insertAt = Math.min(destination - 1, player.queue.length);
        player.queue.splice(insertAt, 0, ...block);
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        tr(
                            ctx,
                            block.length === 1
                                ? 'longtail:music.massMoveMovedOne'
                                : 'longtail:music.massMoveMovedMany',
                            { count: block.length, position: destination }
                        )
                    ),
            ],
        });
    }
}
