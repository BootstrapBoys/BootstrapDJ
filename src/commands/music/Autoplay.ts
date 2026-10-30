import { ApplicationCommandOptionType } from 'discord.js';

import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Autoplay extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: 'autoplay',
            description: {
                content: 'Toggles autoplay',
                examples: ['autoplay'],
                usage: 'autoplay',
            },
            category: 'music',
            aliases: ['ap'],
            cooldown: 3,
            args: false,
            player: {
                voice: true,
                dj: true,
                // Deliberately false: autoplay is what starts playback when
                // nothing is playing, so the active-player guard must not run.
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks', 'Connect', 'Speak'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'seed',
                    description: 'Artist or song to start from (optional)',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }
    public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
        const seed = args.join(' ').trim();
        const vc = ctx.member as any;
        let player = client.queue.get(ctx.guild.id);
        const embed = this.client.embed();

        if (!client.queue.hasNode)
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.red)
                        .setDescription(
                            'No Lavalink node is available right now. Please try again in a moment.'
                        ),
                ],
            });

        // Bare /autoplay while it is on means "turn it off".
        if (!seed && player?.autoplay) {
            await player.setAutoplay(false);
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.main)
                        .setDescription('Autoplay disabled and queued bot picks removed.'),
                ],
            });
        }

        if (!player) player = await client.queue.create(ctx.guild, vc.voice.channel, ctx.channel);

        if (seed) {
            const picked = await player.seedFrom(seed);
            await player.setAutoplay(true);
            return await ctx.sendMessage({
                embeds: [
                    embed.setColor(client.color.main).setDescription(
                        picked
                            ? `Autoplay enabled — seeded from **${seed}**, starting with **${picked.info.title}** by ${picked.info.author}.`
                            : `Autoplay enabled, but I couldn't find anything for **${seed}**. I'll pick tracks when the queue runs out.`
                    ),
                ],
            });
        }

        const first = await player.setAutoplay(true);
        const description = first
            ? `Autoplay enabled — starting from **${first.info.title}** by ${first.info.author}.`
            : 'Autoplay enabled — I will pick tracks when the queue runs out.';
        return await ctx.sendMessage({
            embeds: [embed.setColor(client.color.main).setDescription(description)],
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
