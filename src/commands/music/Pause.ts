import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Pause extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'pause',
            description: {
                content: 'Pauses the current song',
                examples: ['pause'],
                usage: 'pause',
            },
            category: 'music',
            aliases: [],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: false,
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
        if (!player.paused) {
            player.pause();
            return await ctx.sendMessage({
                embeds: [embed.setColor(this.client.color.main).setDescription(`Paused the song`)],
            });
        } else {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription(`The song is already paused`),
                ],
            });
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
