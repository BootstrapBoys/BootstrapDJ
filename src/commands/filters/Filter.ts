import { ApplicationCommandOptionType } from 'discord.js';
import type { ApplicationCommandOption } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

const SIMPLE: Record<string, string> = {
    '8d': '8d',
    bassboost: 'bassboost',
    distortion: 'distorsion',
    karaoke: 'karaoke',
    nightcore: 'nightcore',
    reset: 'reset',
    rotation: 'rotation',
    tremolo: 'tremolo',
    vibrato: 'vibrato',
    lowpass: 'lowpass',
};

const VALUED: Record<string, string> = {
    pitch: 'pitch',
    rate: 'rate',
    speed: 'speed',
};

export default class Filter extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'filter',
            description: {
                content: 'Apply or clear audio filters',
                usage: 'filter <effect> [value]',
                examples: ['filter bassboost', 'filter speed 1.2'],
            },
            category: 'filters',
            aliases: ['filterset'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: true, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [
                ...Object.keys(SIMPLE).map((name): ApplicationCommandOption => ({
                    name,
                    description: `Apply ${name}`,
                    type: ApplicationCommandOptionType.Subcommand,
                })),
                ...Object.keys(VALUED).map((name): ApplicationCommandOption => ({
                    name,
                    description: `Apply ${name} with a value`,
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: 'value',
                            description: 'Effect value',
                            type: ApplicationCommandOptionType.Number,
                            required: true,
                        },
                    ],
                })),
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const effect = (
            ctx.isInteraction && ctx.interaction ? ctx.interaction.options.data[0]?.name : args[0]
        )?.toLowerCase();
        if (!effect) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:filters.chooseEffect')),
                ],
            });
        }
        const target = SIMPLE[effect] ?? VALUED[effect];
        const command = target ? client.commands.get(target) : null;
        if (!command) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(
                            tr(ctx, 'longtail:filters.unknownFilter', { filter: effect })
                        ),
                ],
            });
        }
        const value =
            ctx.isInteraction && ctx.interaction
                ? ctx.interaction.options.data[0]?.options?.[0]?.value
                : args[1];
        return await command.run(client, ctx, value === undefined ? [] : [String(value)]);
    }
}
