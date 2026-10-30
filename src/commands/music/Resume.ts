import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Resume extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'resume',
            description: {
                content: 'Resumes the current song',
                examples: ['resume'],
                usage: 'resume',
            },
            category: 'music',
            aliases: ['r'],
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
    public async run(client: BootstrapClient, ctx: Context): Promise<any> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        const embed = this.client.embed();
        if (!player.paused)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('The player is not paused.'),
                ],
            });
        player.pause();

        return await ctx.sendMessage({
            embeds: [embed.setColor(this.client.color.main).setDescription(`Resumed the player`)],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
