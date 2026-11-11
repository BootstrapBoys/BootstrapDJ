import { EmbedBuilder } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
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

function trackLine(
    ctx: Parameters<typeof tr>[0],
    track: QueueEntry,
    index: number,
    formatTime: (ms: number) => string
): string {
    const duration = track.info.isStream ? 'LIVE' : formatTime(track.info.length);
    return tr(ctx, 'commands:core.queueLine', {
        index: index + 1,
        title: track.info.title,
        uri: track.info.uri ?? '',
        requester: String(track.info.requester),
        duration,
    });
}

function summaryFields(
    ctx: Parameters<typeof tr>[0],
    player: { queue: QueueEntry[]; autoplay: boolean; loop: string },
    total: number,
    formatTime: (ms: number) => string
): Array<{ name: string; value: string; inline: boolean }> {
    return [
        {
            name: tr(ctx, 'commands:core.queuedTracks'),
            value: String(player.queue.length),
            inline: true,
        },
        {
            name: tr(ctx, 'commands:core.queueLength'),
            value: formatTime(total),
            inline: true,
        },
        {
            name: tr(ctx, 'commands:core.autoplay'),
            value: player.autoplay ? tr(ctx, 'commands:core.on') : tr(ctx, 'commands:core.off'),
            inline: true,
        },
        { name: tr(ctx, 'commands:core.loop'), value: player.loop, inline: true },
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
            if (!current)
                return await replyFail(client, ctx, tr(ctx, 'commands:core.nothingPlaying'));

            const duration = current.info.isStream ? 'LIVE' : formatTime(current.info.length);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(
                            tr(ctx, 'commands:core.queueNowPlaying', {
                                title: current.info.title,
                                uri: current.info.uri ?? '',
                                requester: String(current.info.requester),
                                duration,
                            })
                        )
                        .addFields(
                            {
                                name: tr(ctx, 'commands:core.queuedTracks'),
                                value: '0',
                                inline: true,
                            },
                            {
                                name: tr(ctx, 'commands:core.queueLength'),
                                value: '0:00',
                                inline: true,
                            },
                            {
                                name: tr(ctx, 'commands:core.autoplay'),
                                value: player.autoplay
                                    ? tr(ctx, 'commands:core.on')
                                    : tr(ctx, 'commands:core.off'),
                                inline: true,
                            },
                            {
                                name: tr(ctx, 'commands:core.loop'),
                                value: player.loop,
                                inline: true,
                            }
                        ),
                ],
            });
        }

        const lines = player.queue.map((track, index) => trackLine(ctx, track, index, formatTime));
        const total = player.queue.reduce((sum, track) => sum + (track.info.length || 0), 0);
        const chunks = client.utils.chunk(lines, PAGE_SIZE);
        if (chunks.length === 0) chunks.push([]);
        const pages: EmbedBuilder[] = chunks.map((chunk, index) => {
            const embed = client
                .embed()
                .setColor(client.color.main)
                .setAuthor({
                    name: tr(ctx, 'commands:core.queueAuthor'),
                    iconURL: ctx.guild?.iconURL({}) ?? undefined,
                })
                .setDescription(chunk.join('\n'))
                .setFooter({
                    text: tr(ctx, 'commands:core.queuePage', {
                        page: index + 1,
                        total: chunks.length,
                    }),
                });
            if (index === 0) embed.addFields(summaryFields(ctx, player, total, formatTime));
            return embed;
        });

        return await client.utils.paginate(ctx, pages);
    },
});
