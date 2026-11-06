import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Skip extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'skip',
            description: {
                content: 'Skips the current song',
                examples: ['skip'],
                usage: 'skip',
            },
            category: 'music',
            aliases: ['sk'],
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
        if (player.queue.length === 0)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('There are no songs in the queue.'),
                ],
            });
        player.skip();
        if (!ctx.isInteraction) {
            ctx.message?.react('👍');
        } else {
            const current = player.current;
            if (!current)
                return await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(this.client.color.red)
                            .setDescription(`Nothing playing right now`),
                    ],
                });
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.main)
                        .setDescription(`Skipped [${current.info.title}](${current.info.uri})`),
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
