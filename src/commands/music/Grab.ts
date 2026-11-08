import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'grab',
    description: { content: 'Grabs the current playing song', examples: ['grab'], usage: 'grab' },
    aliases: [],
    dj: false,
    voice: false,
    run: async ({ client, ctx, player }) => {
        const author = ctx.author;
        if (!author) return;
        if (!player) return;
        const song = player.current;
        if (!song) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing playing right now')],
            });
        }
        const duration = song.info.isStream ? 'LIVE' : client.utils.formatTime(song.info.length);
        const dm = client
            .embed()
            .setTitle(`**${song.info.title}**`)
            .setURL(song.info.uri ?? null)
            .setThumbnail(song.info.artworkUrl ?? null)
            .setDescription(
                `**Duration:** ${duration}\n**Requested by:** ${song.info.requester}\n**Link:** [Click here](${song.info.uri})`
            )
            .setColor(client.color.main);
        try {
            await author.send({ embeds: [dm] });
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.green).setDescription('**I sent you a DM.**')],
            });
        } catch {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('**I couldn\'t send you a DM.**')],
            });
        }
    },
});
