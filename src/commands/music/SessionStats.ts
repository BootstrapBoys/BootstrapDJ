import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class SessionStats extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'sessionstats',
            description: {
                content: 'Shows statistics for the current playback session',
                usage: 'sessionstats',
                examples: ['sessionstats'],
            },
            category: 'music',
            aliases: ['session'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.sessionStatsNoActive')),
                ],
            });
        }
        const played = player.history.reduce((sum, track) => sum + (track.info.length || 0), 0);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:music.sessionStatsTitle'))
                    .addFields(
                        {
                            name: tr(ctx, 'longtail:music.sessionStatsCurrent'),
                            value: player.current
                                ? `[${player.current.info.title}](${player.current.info.uri})`
                                : tr(ctx, 'longtail:music.sessionStatsNothing'),
                            inline: false,
                        },
                        {
                            name: tr(ctx, 'longtail:music.sessionStatsTracksPlayed'),
                            value: String(player.history.length),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:music.sessionStatsPlayedTime'),
                            value: client.utils.formatTime(played),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:music.sessionStatsQueue'),
                            value: String(player.queue.length),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:music.sessionStatsVolume'),
                            value: `${player.volume}%`,
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:music.sessionStatsLoop'),
                            value: player.loop,
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:music.sessionStatsAutoplay'),
                            value: player.autoplay
                                ? tr(ctx, 'longtail:music.sessionStatsOn')
                                : tr(ctx, 'longtail:music.sessionStatsOff'),
                            inline: true,
                        }
                    ),
            ],
        });
    }
}
