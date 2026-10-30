import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Autoplay extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: 'autoplay',
            description: {
                content: 'Toggles autoplay',
                examples: ['autoplay'],
                usage: 'autoplay',
            },
            category: 'music',
            aliases: ['ap'],
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
    public async run(client: Lavamusic, ctx: Context): Promise<any> {
        const player = client.queue.get(ctx.guild.id);
        const embed = this.client.embed();

        if (player.autoplay) {
            await player.setAutoplay(false);
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.main)
                        .setDescription('Autoplay disabled and queued bot picks removed.'),
                ],
            });
        }

        const first = await player.setAutoplay(true);
        const description = first
            ? `Autoplay enabled — starting from **${first.info.title}** by ${first.info.author}.`
            : 'Autoplay enabled — I will pick tracks when the queue runs out.';
        return await ctx.sendMessage({
            embeds: [embed.setColor(client.color.main).setDescription(description)],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
