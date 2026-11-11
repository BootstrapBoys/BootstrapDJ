import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Replay extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'replay',
            description: {
                content: 'Replays the current track from the start',
                examples: ['replay'],
                usage: 'replay',
            },
            category: 'music',
            aliases: [],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: false,
                active: true,
                djPerm: null,
            },
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
        const embed = client.embed();
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.replay.nothingPlaying')),
                ],
            });
        }
        if (player.current.info.isStream || !player.current.info.isSeekable) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.replay.notSeekable')),
                ],
            });
        }

        player.seek(0);
        return await ctx.sendMessage({
            embeds: [
                embed.setColor(client.color.main).setDescription(
                    tr(ctx, 'longtail:music.replay.replaying', {
                        title: player.current.info.title,
                    })
                ),
            ],
        });
    }
}
