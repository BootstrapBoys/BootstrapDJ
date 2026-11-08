import { EmbedBuilder } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail } from '../../lib/reply.js';

type QueueEntry = {
    info: {
        title: string;
        uri?: string | null;
        requester: unknown;
        length: number;
        isStream: boolean;
    };
};

const PAGE_SIZE = 10;

function trackLine(track: QueueEntry, index: number, formatTime: (ms: number) => string): string {
    const duration = track.info.isStream ? 'LIVE' : formatTime(track.info.length);
    return `${index + 1}. [${track.info.title}](${track.info.uri}) - Request By: ${track.info.requester} - Duration: ${duration}`;
}

function summaryFields(
    player: { queue: QueueEntry[]; autoplay: boolean; loop: string },
    total: number,
    formatTime: (ms: number) => string
): Array<{ name: string; value: string; inline: boolean }> {
    return [
        { name: 'Queued tracks', value: String(player.queue.length), inline: true },
        { name: 'Queue length', value: formatTime(total), inline: true },
        { name: 'Autoplay', value: player.autoplay ? 'on' : 'off', inline: true },
        { name: 'Loop', value: player.loop, inline: true },
    ];
}

export default defineMusicCommand({
    name: 'queue',
    description: { content: 'Shows the current queue', examples: ['queue'], usage: 'queue' },
    aliases: ['q'],
    dj: false,
    ephemeral: false,
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        const formatTime = (ms: number): string => client.utils.formatTime(ms);

        if (player.queue.length === 0) {
            const current = player.current;
            if (!current) return await replyFail(client, ctx, 'Nothing playing right now');

            const duration = current.info.isStream ? 'LIVE' : formatTime(current.info.length);
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

        const lines = player.queue.map((track, index) => trackLine(track, index, formatTime));
        const total = player.queue.reduce((sum, track) => sum + (track.info.length || 0), 0);
        const chunks = client.utils.chunk(lines, PAGE_SIZE);
        if (chunks.length === 0) chunks.push([]);
        const pages: EmbedBuilder[] = chunks.map((chunk, index) => {
            const embed = client
                .embed()
                .setColor(client.color.main)
                .setAuthor({ name: 'Queue', iconURL: ctx.guild?.iconURL({}) ?? undefined })
                .setDescription(chunk.join('\n'))
                .setFooter({ text: `Page ${index + 1} of ${chunks.length}` });
            if (index === 0) embed.addFields(summaryFields(player, total, formatTime));
            return embed;
        });

        return await client.utils.paginate(ctx, pages);
    },
});
