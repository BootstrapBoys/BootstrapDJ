import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class _247 extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: '247',
            description: {
                content: 'set the bot to stay in the vc',
                examples: ['247'],
                usage: '247',
            },
            category: 'config',
            aliases: ['stay'],
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
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [],
        });
    }
    public async run(client: Lavamusic, ctx: Context): Promise<any> {
        const guild = ctx.guild;
        const channel = ctx.channel;
        if (!guild || !channel) return;
        const embed = client.embed();
        let player = client.shoukaku.players.get(guild.id) as any;

        const data = await client.db.get_247(guild.id);
        const vc = ctx.member as any;
        if (!data) {
            client.db.set_247(guild.id, channel.id, vc.voice.channel.id);
            if (!player)
                await client.queue.create(
                    guild,
                    vc.voice.channel,
                    channel,
                    client.shoukaku.options.nodeResolver(client.shoukaku.nodes)
                );
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setDescription(`**247 mode has been enabled**`)
                        .setColor(client.color.main),
                ],
            });
        } else {
            client.db.delete_247(guild.id);
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setDescription(`**247 mode has been disabled**`)
                        .setColor(client.color.red),
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
