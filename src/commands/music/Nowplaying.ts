import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { getNowPlayingButtons } from '../../utils/Buttons.js';

export default class Nowplaying extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'nowplaying',
            description: {
                content: 'Shows the currently playing song',
                examples: ['nowplaying'],
                usage: 'nowplaying',
            },
            category: 'music',
            aliases: ['np'],
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
            ephemeral: false,
            options: [],
        });
    }
    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);

        const track = player.current;
        if (!track)
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.red)
                        .setDescription(`Nothing playing right now`),
                ],
            });
        const position = player.player.position;
        const duration = track.info.length;
        const bar = track.info.isStream
            ? '🔴 LIVE'
            : client.utils.progressBar(position, duration, 14);
        const timing = track.info.isStream
            ? '`🔴 LIVE`'
            : `\`${client.utils.formatTime(position)} / ${client.utils.formatTime(duration)}\``;
        const embed1 = this.client
            .embed()
            .setColor(this.client.color.main)
            .setAuthor({ name: 'Now Playing', iconURL: guild.iconURL({}) ?? undefined })
            .setThumbnail(track.info.artworkUrl ?? null)
            .setDescription(
                `[${track.info.title}](${track.info.uri}) · Requested by ${track.info.requester}\n\n\`${bar}\` ${timing}`
            );
        const message = await ctx.sendMessage({ embeds: [embed1], components: getNowPlayingButtons() });
        player.registerNowPlayingMessage(message, track.info.isStream ? null : track.info.length);
        return message;
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
