import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Volume extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'volume',
            description: {
                content: 'Sets the volume of the player',
                examples: ['volume 100'],
                usage: 'volume <number>',
            },
            category: 'music',
            aliases: ['vol'],
            cooldown: 3,
            args: true,
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
            slashCommand: true,
            options: [
                {
                    name: 'number',
                    description: 'The volume you want to set',
                    type: 4,
                    required: true,
                },
            ],
        });
    }
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player)
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.red)
                        .setDescription('There is no music playing in this server.'),
                ],
            });
        const embed = this.client.embed();
        const number = Number(args[0]);
        if (isNaN(number))
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('Please provide a valid number.'),
                ],
            });
        if (number > 200)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('The volume can\'t be higher than 200.'),
                ],
            });
        if (number < 0)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(this.client.color.red)
                        .setDescription('The volume can\'t be lower than 0.'),
                ],
            });
        player.player.setGlobalVolume(number);
        return await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(this.client.color.main)
                    .setDescription(`Set the volume to ${player.player.volume}`),
            ],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
