import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Move extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'move',
            description: {
                content: 'Moves a queued track to another position',
                examples: ['move 3 to 1', 'move 2 1'],
                usage: 'move <from> to <to>',
            },
            category: 'music',
            aliases: ['mv'],
            cooldown: 3,
            args: true,
            player: {
                voice: true,
                dj: true,
                active: true,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'from',
                    description: 'Current queue position (1-based)',
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    minValue: 1,
                },
                {
                    name: 'to',
                    description: 'New queue position (1-based)',
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
        const embed = client.embed();
        if (!player?.current || !player.queue.length) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription('There are no queued tracks to move.'),
                ],
            });
        }

        const from = Number(args[0]);
        const to = Number(args[1]?.toLowerCase() === 'to' ? args[2] : args[1]);
        if (!Number.isInteger(from) || !Number.isInteger(to)) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription('Give two queue positions, for example `move 3 to 1`.'),
                ],
            });
        }

        const fromIndex = from - 1;
        const toIndex = to - 1;
        if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= player.queue.length ||
            toIndex >= player.queue.length
        ) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription(`Positions must be between 1 and ${player.queue.length}.`),
                ],
            });
        }

        if (fromIndex === toIndex) {
            return await ctx.sendMessage({
                embeds: [embed.setColor(client.color.main).setDescription('That track is already there.')],
            });
        }

        const [track] = player.queue.splice(fromIndex, 1);
        player.queue.splice(toIndex, 0, track);
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(client.color.main)
                    .setDescription(`Moved **${track.info.title}** to position ${to}.`),
            ],
        });
    }
}
