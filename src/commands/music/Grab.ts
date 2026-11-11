import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyDone, replyFail } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'grab',
    description: { content: 'Grabs the current playing song', examples: ['grab'], usage: 'grab' },
    aliases: [],
    dj: false,
    voice: false,
    run: async ({ client, ctx, player }) => {
        const author = ctx.author;
        if (!author || !player) return;

        const song = player.current;
        if (!song) return await replyFail(client, ctx, tr(ctx, 'commands:core.nothingPlaying'));

        const duration = song.info.isStream
            ? tr(ctx, 'longtail:music.live')
            : client.utils.formatTime(song.info.length);
        const card = client
            .embed()
            .setTitle(`**${song.info.title}**`)
            .setURL(song.info.uri ?? null)
            .setThumbnail(song.info.artworkUrl ?? null)
            .setDescription(
                tr(ctx, 'commands:core.grabCard', {
                    duration,
                    requester: String(song.info.requester),
                    uri: song.info.uri ?? '',
                })
            )
            .setColor(client.color.main);

        try {
            await author.send({ embeds: [card] });
            return await replyDone(client, ctx, tr(ctx, 'commands:core.dmSent'));
        } catch {
            return await replyFail(client, ctx, tr(ctx, 'commands:core.dmFailed'));
        }
    },
});
