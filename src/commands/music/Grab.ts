import { defineMusicCommand } from '../../lib/musicCommand.js';
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
        if (!song) return await replyFail(client, ctx, 'Nothing playing right now');

        const duration = song.info.isStream ? 'LIVE' : client.utils.formatTime(song.info.length);
        const card = client
            .embed()
            .setTitle(`**${song.info.title}**`)
            .setURL(song.info.uri ?? null)
            .setThumbnail(song.info.artworkUrl ?? null)
            .setDescription(
                `**Duration:** ${duration}\n**Requested by:** ${song.info.requester}\n**Link:** [Click here](${song.info.uri})`
            )
            .setColor(client.color.main);

        try {
            await author.send({ embeds: [card] });
            return await replyDone(client, ctx, '**I sent you a DM.**');
        } catch {
            return await replyFail(client, ctx, '**I couldn\'t send you a DM.**');
        }
    },
});
