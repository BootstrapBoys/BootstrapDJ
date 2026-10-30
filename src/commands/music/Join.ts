import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Join extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: 'join',
            description: {
                content: 'Joins the voice channel',
                examples: ['join'],
                usage: 'join',
            },
            category: 'music',
            aliases: ['j'],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: false,
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
        let player = client.queue.get(guild.id);
        const embed = this.client.embed();
        if (!player) {
            const vc = ctx.voiceChannel;
            player = await client.queue.create(
                guild,
                vc,
                ctx.channel,
                client.shoukaku.options.nodeResolver(client.shoukaku.nodes)
            );
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.main)
                        .setDescription(
                            `Joined <#${player.node.manager.connections.get(guild.id)?.channelId}>`
                        ),
                ],
            });
        } else {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.main)
                        .setDescription(
                            `I'm already connected to <#${player.node.manager.connections.get(guild.id)?.channelId}>`
                        ),
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
