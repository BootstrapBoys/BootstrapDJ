import { getNowPlayingButtons } from '../../lib/Buttons.js';
import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyFail } from '../../lib/reply.js';

const BAR_WIDTH = 14;

export default defineMusicCommand({
    name: 'nowplaying',
    description: {
        content: 'Shows the currently playing song',
        examples: ['nowplaying'],
        usage: 'nowplaying',
    },
    aliases: ['np'],
    dj: false,
    ephemeral: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        const track = player.current;
        if (!track) return await replyFail(client, ctx, tr(ctx, 'commands:core.nothingPlaying'));

        const position = player.player.position;
        const duration = track.info.length;
        const live = track.info.isStream;
        const bar = live ? '🔴 LIVE' : client.utils.progressBar(position, duration, BAR_WIDTH);
        const timing = live
            ? '`🔴 LIVE`'
            : `\`${client.utils.formatTime(position)} / ${client.utils.formatTime(duration)}\``;

        const embed = client
            .embed()
            .setColor(client.color.main)
            .setAuthor({ name: 'Now Playing', iconURL: ctx.guild?.iconURL({}) ?? undefined })
            .setThumbnail(track.info.artworkUrl ?? null)
            .setDescription(
                tr(ctx, 'commands:core.nowPlayingLine', {
                    title: track.info.title,
                    uri: track.info.uri ?? '',
                    requester: String(track.info.requester),
                    bar,
                    timing,
                })
            );

        const message = await ctx.sendMessage({
            embeds: [embed],
            components: getNowPlayingButtons(),
        });
        player.registerNowPlayingMessage(message, live ? null : track.info.length);
        return message;
    },
});
