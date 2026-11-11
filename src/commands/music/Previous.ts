import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Previous extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'previous',
            description: {
                content: 'Plays the previous track again',
                usage: 'previous',
                examples: ['previous'],
            },
            category: 'music',
            aliases: ['prev'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: false, active: true, djPerm: null },
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
        if (!player?.previous) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.previous.none')),
                ],
            });
        }
        const title = player.previous.info.title;
        player.previousTrack();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(tr(ctx, 'longtail:music.previous.goingBack', { title })),
            ],
        });
    }
}
