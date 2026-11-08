import { BootstrapClient, Command, Context } from '../../core/index.js';

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
        const gameLines = gameScores.map(
            (score, index) =>
                `**${index + 1}.** <@${score.userId}> — ${score.wins} win${score.wins === 1 ? '' : 's'} / ${score.plays} played`
        );
        if (!player) {
            if (!gameLines.length) {
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription('No session or game results to rank.'),
                    ],
                });
            }
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle('Game leaderboard')
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
                        .setDescription('No requests have been recorded this session.'),
                ],
            });
        }
        const lines = [...counts.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(
                ([id, count], index) =>
                    `**${index + 1}.** <@${id}> — ${count} request${count === 1 ? '' : 's'}`
            );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Session leaderboards')
                    .setDescription(
                        `${lines.join('\n')}${gameLines.length ? `\n\n**Games**\n${gameLines.join('\n')}` : ''}`
                    ),
            ],
        });
    }
}
