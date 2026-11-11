import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Leaderboard extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'leaderboard',
            description: {
                content: 'Shows the most active requesters this session',
                usage: 'leaderboard',
                examples: ['leaderboard'],
            },
            category: 'info',
            aliases: ['lb', 'leaderboards'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        const gameScores = await client.db.getGameLeaderboard(guild.id);
        const gameLines = gameScores.map((score, index) =>
            tr(
                ctx,
                `longtail:tools.${
                    score.wins === 1 ? 'leaderboardGameLineOne' : 'leaderboardGameLineMany'
                }`,
                { rank: index + 1, user: score.userId, wins: score.wins, plays: score.plays }
            )
        );
        if (!player) {
            if (!gameLines.length) {
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription(tr(ctx, 'longtail:tools.leaderboardNoResults')),
                    ],
                });
            }
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle(tr(ctx, 'longtail:tools.leaderboardGameTitle'))
                        .setDescription(gameLines.join('\n')),
                ],
            });
        }
        const counts = new Map<string, number>();
        const tracks = [
            ...(player.current ? [player.current] : []),
            ...player.history,
            ...player.queue,
        ];
        for (const track of tracks) {
            const requester = track.info.requester as { id?: string } | undefined;
            if (requester?.id) counts.set(requester.id, (counts.get(requester.id) ?? 0) + 1);
        }
        if (!counts.size) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(tr(ctx, 'longtail:tools.leaderboardNoRequests')),
                ],
            });
        }
        const lines = [...counts.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([id, count], index) =>
                tr(
                    ctx,
                    `longtail:tools.${
                        count === 1 ? 'leaderboardSessionLineOne' : 'leaderboardSessionLineMany'
                    }`,
                    { rank: index + 1, user: id, count }
                )
            );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:tools.leaderboardSessionTitle'))
                    .setDescription(
                        `${lines.join('\n')}${
                            gameLines.length
                                ? `\n\n${tr(ctx, 'longtail:tools.leaderboardGamesHeading')}\n${gameLines.join('\n')}`
                                : ''
                        }`
                    ),
            ],
        });
    }
}
