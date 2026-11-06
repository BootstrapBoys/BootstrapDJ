import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Rotation extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'rotation',
            description: {
                content: 'on/off rotation filter',
                examples: ['rotation'],
                usage: 'rotation',
            },
            category: 'filters',
            aliases: ['rt'],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: true,
                active: true,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: false,
            options: [],
        });
    }
    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        if (!ctx.guild) return await ctx.sendMessage({ content: 'This command only works in a server.' });
        const player = client.queue.get(ctx.guild.id);

        if (player.filters.includes('rotation')) {
            player.player.setRotation();
            player.filters.splice(player.filters.indexOf('rotation'), 1);
            ctx.sendMessage({
                embeds: [
                    {
                        description: 'rotation filter has been disabled',
                        color: client.color.main,
                    },
                ],
            });
        } else {
            player.player.setRotation({ rotationHz: 0.2 });
            player.filters.push('rotation');
            ctx.sendMessage({
                embeds: [
                    {
                        description: 'rotation filter has been enabled',
                        color: client.color.main,
                    },
                ],
            });
        }
    }
}
