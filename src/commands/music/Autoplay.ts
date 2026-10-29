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

        const autoplay = player.autoplay;
        if (!autoplay) {
            embed.setDescription(`Autoplay has been enabled`).setColor(client.color.main);
            player.setAutoplay(true);
        } else {
            embed.setDescription(`Autoplay has been disabled`).setColor(client.color.main);
            player.setAutoplay(false);
        }
        ctx.sendMessage({ embeds: [embed] });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
