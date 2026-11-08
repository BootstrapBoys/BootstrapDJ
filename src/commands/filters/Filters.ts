import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Filters extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'filters',
            description: { content: 'Shows active audio filters', usage: 'filters', examples: ['filters'] },
            category: 'filters',
            aliases: ['activefilters'],
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
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing is playing right now.')],
            });
        }
        const filters = player.filters.length ? player.filters.join(', ') : 'none';
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Active filters')
                    .setDescription(filters),
            ],
        });
    }
}
