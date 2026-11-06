import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Tremolo extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'tremolo',
            description: {
                content: 'on/off the tremolo filter',
                examples: ['tremolo'],
                usage: 'tremolo',
            },
            category: 'filters',
            aliases: ['tremolo'],
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
        if (!player)
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.red)
                        .setDescription('There is no music playing in this server.'),
                ],
            });

        if (player.filters.includes('tremolo')) {
            player.player.setTremolo();
            player.filters.splice(player.filters.indexOf('tremolo'), 1);
            ctx.sendMessage({
                embeds: [
                    {
                        description: 'tremolo filter has been disabled',
                        color: client.color.main,
                    },
                ],
            });
        } else {
            player.player.setTremolo({ depth: 0.75, frequency: 4 });
            player.filters.push('tremolo');
            ctx.sendMessage({
                embeds: [
                    {
                        description: 'tremolo filter has been enabled',
                        color: client.color.main,
                    },
                ],
            });
        }
    }
}
