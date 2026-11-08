import { EmbedBuilder } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';

type QueueEntry = { info: { title: string; uri?: string; requester: unknown; length: number; isStream: boolean } };

function lineFor(track: QueueEntry, index: number, formatTime: (ms: number) => string): string {
    const duration = track.info.isStream ? 'LIVE' : formatTime(track.info.length);
    return `${index + 1}. [${track.info.title}](${track.info.uri}) - Request By: ${track.info.requester} - Duration: ${duration}`;
}

export default defineMusicCommand({
    name: 'queue',
    description: { content: 'Shows the current queue', examples: ['queue'], usage: 'queue' },
    aliases: ['q'],
    dj: false,
    ephemeral: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        const current = player.current;
        if (!player.queue.length) {
            if (!current) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Nothing playing right now')],
                });
            }
            const duration = current.info.isStream ? 'LIVE' : client.utils.formatTime(current.info.length);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(
                            `Now playing: [${current.info.title}](${current.info.uri}) - Request By: ${current.info.requester} - Duration: ${duration}`
                        )
                        .addFields(
                            { name: 'Queued tracks', value: '0', inline: true },
                            { name: 'Queue length', value: '0:00', inline: true },
                            { name: 'Autoplay', value: player.autoplay ? 'on' : 'off', inline: true },
                            { name: 'Loop', value: player.loop, inline: true }
                        ),
                ],
            });
        }

        const lines = player.queue.map((track, index) =>
            lineFor(track, index, ms => client.utils.formatTime(ms))
        );
        const total = player.queue.reduce((sum, track) => sum + (track.info.length || 0), 0);
        const chunks = client.utils.chunk(lines, 10);
        if (!chunks.length) chunks.push([]);
        const pages: EmbedBuilder[] = chunks.map((chunk, index) => {
            const embed = client
                .embed()
                .setColor(client.color.main)
                .setAuthor({ name: 'Queue', iconURL: ctx.guild?.iconURL({}) ?? undefined })
                .setDescription(chunk.join('\n'))
                .setFooter({ text: `Page ${index + 1} of ${chunks.length}` });
            if (index === 0) {
                embed.addFields(
                    { name: 'Queued tracks', value: String(player.queue.length), inline: true },
                    { name: 'Queue length', value: client.utils.formatTime(total), inline: true },
                    { name: 'Autoplay', value: player.autoplay ? 'on' : 'off', inline: true },
                    { name: 'Loop', value: player.loop, inline: true }
                );
            }
            return embed;
        });
        return await client.utils.paginate(ctx, pages);
    },
});
