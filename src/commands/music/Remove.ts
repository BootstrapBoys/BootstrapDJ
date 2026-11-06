import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Remove extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'remove',
            description: {
                content: 'Removes a song from the queue',
                examples: ['remove 1'],
                usage: 'remove <song number>',
            },
            category: 'music',
            aliases: ['rm'],
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
                    name: 'song',
                    description: 'The song number',
                    type: 4,
                    required: true,
                },
            ],
        });
    }
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player)
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.red)
                        .setDescription('There is no music playing in this server.'),
                ],
            });
        const embed = this.client.embed();
        if (!player.queue.length)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('There are no songs in the queue.'),
                ],
            });
        if (isNaN(Number(args[0])))
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('That is not a valid number.'),
                ],
            });
        if (Number(args[0]) > player.queue.length)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('That is not a valid number.'),
                ],
            });
        if (Number(args[0]) < 1)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('That is not a valid number.'),
                ],
            });
        player.remove(Number(args[0]) - 1);
        return await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(this.client.color.main)
                    .setDescription(`Removed song number ${Number(args[0])} from the queue`),
            ],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
