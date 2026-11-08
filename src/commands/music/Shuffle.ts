import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Shuffle extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'shuffle',
            description: {
                content: 'Shuffles the queue',
                examples: ['shuffle'],
                usage: 'shuffle',
            },
            category: 'music',
            aliases: ['sh'],
            cooldown: 3,
            args: false,
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
            options: [],
        });
    }
    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
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
        player.setShuffle();

        return await ctx.sendMessage({
            embeds: [embed.setColor(this.client.color.main).setDescription(`Shuffled the queue`)],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
