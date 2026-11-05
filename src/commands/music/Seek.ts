import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Seek extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'seek',
            description: {
                content: 'Seeks to a certain time in the song',
                examples: ['seek 1m, seek 1h 30m'],
                usage: 'seek <time>',
            },
            category: 'music',
            aliases: ['se', 'windto', 'seekto'],
            cooldown: 3,
            args: true,
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
            options: [
                {
                    name: 'time',
                    description: 'The time to seek to',
                    type: 3,
                    required: true,
                },
            ],
        });
    }
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        const embed = this.client.embed();

        const time = client.utils.parseTime(args[0]);
        if (!time)
            return await ctx.sendMessage({
                embeds: [
                    embed.setColor(this.client.color.red).setDescription('Invalid time format.'),
                ],
            });
        player.seek(time);

        return await ctx.sendMessage({
            embeds: [embed.setColor(this.client.color.main).setDescription(`Seeked to ${args[0]}`)],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
