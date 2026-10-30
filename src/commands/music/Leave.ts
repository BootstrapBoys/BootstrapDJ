import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Leave extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: 'leave',
            description: {
                content: 'Leaves the voice channel',
                examples: ['leave'],
                usage: 'leave',
            },
            category: 'music',
            aliases: ['dc'],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: true,
                active: false,
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
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        const embed = this.client.embed();
        if (player) {
            ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.main)
                        .setDescription(
                            `Left <#${player.node.manager.connections.get(guild.id)?.channelId}>`
                        ),
                ],
            });
            player.destroy();
        } else {
            ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription(`I'm not in a voice channel`),
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
