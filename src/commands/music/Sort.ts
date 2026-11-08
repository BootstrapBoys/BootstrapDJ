import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { SortDirection, SortField, sortQueue } from '../../lib/QueueTools.js';

export default class Sort extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'sort',
            description: {
                content: 'Sorts the queued tracks',
                usage: 'sort <by> [order]',
                examples: ['sort by:title order:asc'],
            },
            category: 'music',
            aliases: ['sortqueue'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: true, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'by',
                    description: 'Field to sort by',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'Title', value: 'title' },
                        { name: 'Author', value: 'author' },
                        { name: 'Duration', value: 'duration' },
                        { name: 'Requester', value: 'requester' },
                    ],
                },
                {
                    name: 'order',
                    description: 'Sort direction',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: [
                        { name: 'Ascending', value: 'asc' },
                        { name: 'Descending', value: 'desc' },
                    ],
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
                        .setDescription('There is no queue to sort.'),
                ],
            });
        }
        const field = (ctx.isInteraction ? ctx.interaction?.options.getString('by') : args[0]) as
            SortField | undefined;
        const direction = ((ctx.isInteraction
            ? ctx.interaction?.options.getString('order')
            : args[1]) ?? 'asc') as SortDirection;
        if (!field || !['title', 'author', 'duration', 'requester'].includes(field)) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('Sort by `title`, `author`, `duration`, or `requester`.'),
                ],
            });
        }
        if (!['asc', 'desc'].includes(direction)) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('Order must be `asc` or `desc`.'),
                ],
            });
        }
        player.queue = sortQueue(player.queue, field, direction);
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        `Sorted ${player.queue.length} queued tracks by **${field}** (${direction}).`
                    ),
            ],
        });
    }
}
