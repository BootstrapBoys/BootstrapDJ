import { BootstrapClient, Command, Context } from '../../core/index.js';

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
                        .setDescription('No session is active.'),
                ],
            });
        }
        const played = player.history.reduce((sum, track) => sum + (track.info.length || 0), 0);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Session statistics')
                    .addFields(
                        {
                            name: 'Current',
                            value: player.current
                                ? `[${player.current.info.title}](${player.current.info.uri})`
                                : 'Nothing',
                            inline: false,
                        },
                        {
                            name: 'Tracks played',
                            value: String(player.history.length),
                            inline: true,
                        },
                        {
                            name: 'Played time',
                            value: client.utils.formatTime(played),
                            inline: true,
                        },
                        { name: 'Queue', value: String(player.queue.length), inline: true },
                        { name: 'Volume', value: `${player.volume}%`, inline: true },
                        { name: 'Loop', value: player.loop, inline: true },
                        { name: 'Autoplay', value: player.autoplay ? 'on' : 'off', inline: true }
                    ),
            ],
        });
    }
}
