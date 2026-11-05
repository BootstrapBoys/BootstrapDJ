import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class RemoveCurrent extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'removecurrent',
            description: { content: 'Stops the current track and advances the queue', usage: 'removecurrent', examples: ['removecurrent'] },
            category: 'music',
            aliases: ['rc'],
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
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing is playing right now.')],
            });
        }
        const title = player.current.info.title;
        await player.skip();
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Removed **${title}** and moved to the next track.`),
            ],
        });
    }
}
