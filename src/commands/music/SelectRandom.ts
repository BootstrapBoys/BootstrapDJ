import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class SelectRandom extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'selectrandom',
            description: {
                content: 'Moves a random queued track to the front',
                usage: 'selectrandom',
                examples: ['selectrandom'],
            },
            category: 'music',
            aliases: ['randompick'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: true, active: true, djPerm: null },
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
        if (!player?.current || !player.queue.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.selectRandom.empty')),
                ],
            });
        }
        const index = Math.floor(Math.random() * player.queue.length);
        const [track] = player.queue.splice(index, 1);
        player.queue.unshift(track);
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        tr(ctx, 'longtail:music.selectRandom.next', {
                            title: track.info.title,
                        })
                    ),
            ],
        });
    }
}
