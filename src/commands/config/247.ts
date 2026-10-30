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
        const player = client.shoukaku.players.get(guild.id);

        const data = await client.db.get_247(guild.id);
        const vc = ctx.voiceChannel;
        if (!vc)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setDescription('You must be connected to a voice channel to use 24/7 mode.')
                        .setColor(client.color.red),
                ],
            });
        if (!data) {
            client.db.set_247(guild.id, channel.id, vc.id);
            if (!player)
                await client.queue.create(
                    guild,
                    vc,
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
