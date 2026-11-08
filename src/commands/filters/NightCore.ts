import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class NightCore extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'nightcore',
            description: {
                content: 'on/off nightcore filter',
                examples: ['nightcore'],
                usage: 'nightcore',
            },
            category: 'filters',
            aliases: ['nc'],
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
                user: [],
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
        if (player.filters.includes('nightcore')) {
            player.player.setTimescale();
            player.filters.splice(player.filters.indexOf('nightcore'), 1);
            ctx.sendMessage({
                embeds: [
                    {
                        description: 'Nightcore filter has been disabled',
                        color: client.color.main,
                    },
                ],
            });
        } else {
            player.player.setTimescale({ speed: 1.165, pitch: 1.125, rate: 1.05 });
            player.filters.push('nightcore');
            ctx.sendMessage({
                embeds: [
                    {
                        description: 'Nightcore filter has been enabled',
                        color: client.color.main,
                    },
                ],
            });
        }
    }
}
