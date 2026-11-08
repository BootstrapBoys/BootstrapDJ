import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Autoplay extends Command {
    constructor(client: BootstrapClient) {
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
            // seedFrom() resolves through Lavalink and may create the player,
            // which can exceed Discord's 3s acknowledgement window.
            defer: true,
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
                    description: 'First artist or song',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'seed2',
                    description: 'Second artist or song (optional)',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'seed3',
                    description: 'Third artist or song (optional)',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }
    /** Slash commands use the three option boxes; prefix commands keep the
     * comma-separated form (and a single multi-word seed still works). */
    private seedsFrom(ctx: Context, args: string[]): string[] {
        if (ctx.isInteraction) {
            return ['seed', 'seed2', 'seed3']
                .map(name => ctx.interaction?.options.getString(name)?.trim() ?? '')
                .filter(Boolean)
                .slice(0, 3);
        }
        return args
            .join(' ')
            .split(',')
            .map(seed => seed.trim())
            .filter(Boolean)
            .slice(0, 3);
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const seeds = this.seedsFrom(ctx, args);
        const seedLabel = seeds.join(', ');
        const guild = ctx.guild;
        if (!guild) return;
        const vc = ctx.voiceChannel;
        let player = client.queue.get(guild.id);
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
        if (!seeds.length && player?.autoplay) {
            await player.setAutoplay(false);
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.main)
                        .setDescription('Autoplay disabled and queued bot picks removed.'),
                ],
            });
        }

        if (!player || player.isStale) player = await client.queue.create(guild, vc, ctx.channel);

        if (seeds.length) {
            const picked = await player.seedFrom(seeds);
            await player.setAutoplay(true);
            return await ctx.sendMessage({
                embeds: [
                    embed.setColor(client.color.main).setDescription(
                        picked
                            ? `Autoplay enabled — seeded from **${seedLabel}**, starting with **${picked.info.title}** by ${picked.info.author}.`
                            : `Autoplay enabled, but I couldn't find anything for **${seedLabel}**. I'll pick tracks when the queue runs out.`
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
