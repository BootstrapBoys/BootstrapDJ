import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Reset extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'reset',
            description: {
                content: 'Resets the active filters',
                examples: ['reset'],
                usage: 'reset',
            },
            category: 'filters',
            aliases: ['reset'],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: true,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [],
        });
    }
    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        if (!ctx.guild) return await ctx.sendMessage({ content: 'This command only works in a server.' });
        const player = client.queue.get(ctx.guild.id);

        player.player.clearFilters();
        player.filters = [];
        return await ctx.sendMessage({
            embeds: [
                {
                    description: 'Filters have been reset',
                    color: client.color.main,
                },
            ],
        });
    }
}
