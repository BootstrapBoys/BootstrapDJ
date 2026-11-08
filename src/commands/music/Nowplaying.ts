import { getNowPlayingButtons } from '../../lib/Buttons.js';
import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'nowplaying',
    description: { content: 'Shows the currently playing song', examples: ['nowplaying'], usage: 'nowplaying' },
    aliases: ['np'],
    dj: false,
    ephemeral: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        const track = player.current;
        if (!track) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing playing right now')],
            });
        }
        const position = player.player.position;
        const duration = track.info.length;
        const bar = track.info.isStream ? '🔴 LIVE' : client.utils.progressBar(position, duration, 14);
        const timing = track.info.isStream
            ? '`🔴 LIVE`'
            : `\`${client.utils.formatTime(position)} / ${client.utils.formatTime(duration)}\``;
        const embed = client
            .embed()
            .setColor(client.color.main)
            .setAuthor({ name: 'Now Playing', iconURL: ctx.guild?.iconURL({}) ?? undefined })
            .setThumbnail(track.info.artworkUrl ?? null)
            .setDescription(
                `[${track.info.title}](${track.info.uri}) · Requested by ${track.info.requester}\n\n\`${bar}\` ${timing}`
            );
        const message = await ctx.sendMessage({ embeds: [embed], components: getNowPlayingButtons() });
        player.registerNowPlayingMessage(message, track.info.isStream ? null : track.info.length);
        return message;
    },
});
