import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { removeRange } from '../../lib/QueueTools.js';

export default class MassRemove extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'massremove',
            description: {
                content: 'Removes a range of queued tracks',
                usage: 'massremove <from> <to>',
                examples: ['massremove 2 5'],
            },
            category: 'music',
            aliases: ['mr'],
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
                    description: 'First position to remove (1-based)',
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    minValue: 1,
                },
                {
                    name: 'to',
                    description: 'Last position to remove (1-based)',
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
        if (!player?.current || !player.queue.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.queueEmpty')),
                ],
            });
        }
        const from = Number(args[0]);
        const to = Number(args[1]);
        if (
            !Number.isInteger(from) ||
            !Number.isInteger(to) ||
            from < 1 ||
            to < from ||
            to > player.queue.length
        ) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(
                            tr(ctx, 'longtail:music.massRemoveInvalidRange', {
                                max: player.queue.length,
                            })
                        ),
                ],
            });
        }
        const removed = removeRange(player.queue, from, to);
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        tr(
                            ctx,
                            removed.length === 1
                                ? 'longtail:music.massRemoveRemovedOne'
                                : 'longtail:music.massRemoveRemovedMany',
                            { count: removed.length }
                        )
                    ),
            ],
        });
    }
}
