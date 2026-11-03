import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

type AutoplaySource = 'chart' | 'curated' | 'legacy';
type AutoplaySettingRow = Awaited<ReturnType<BootstrapClient['db']['getAutoplaySetting']>>;

const SOURCES: AutoplaySource[] = ['chart', 'curated', 'legacy'];

export default class AutoplayConfig extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'autoplayconfig',
            description: {
                content: 'Configures the autoplay cold-start source',
                examples: [
                    'autoplayconfig',
                    'autoplayconfig source:chart',
                    'autoplayconfig seeds:NF, Hotel Books',
                    'autoplayconfig reset:true',
                ],
                usage: 'autoplayconfig [source] [seeds] [reset]',
            },
            category: 'config',
            aliases: ['apconfig'],
            cooldown: 3,
            args: false,
            player: {
                voice: false,
                dj: true,
                active: false,
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
                    name: 'source',
                    description: 'Cold-start seed source',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: [
                        { name: 'Deezer chart', value: 'chart' },
                        { name: 'Curated seed list', value: 'curated' },
                        { name: 'Legacy AUTOPLAY_SEED', value: 'legacy' },
                    ],
                },
                {
                    name: 'seeds',
                    description: 'Curated seeds, comma-separated (sets source to curated)',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    maxLength: 500,
                },
                {
                    name: 'reset',
                    description: 'Remove the guild override and use environment defaults',
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        });
    }

    private async currentSetting(
        client: BootstrapClient,
        guildId: string
    ): Promise<AutoplaySettingRow | null> {
        return await client.db.getAutoplaySetting(guildId).catch(() => null);
    }

    private async show(
        client: BootstrapClient,
        ctx: Context,
        setting: AutoplaySettingRow | null
    ): Promise<unknown> {
        const envSeeds = client.config.autoplaySeeds;
        const storedSeeds = (setting?.seeds ?? '')
            .split(',')
            .map(seed => seed.trim())
            .filter(Boolean);
        const effectiveSource: AutoplaySource =
            (setting?.source as AutoplaySource | undefined) ??
            (client.config.autoplayChart ? 'chart' : storedSeeds.length || envSeeds.length ? 'curated' : 'legacy');
        const seeds = storedSeeds.length ? storedSeeds : envSeeds;
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Autoplay cold-start configuration')
                    .setDescription(
                        [
                            `**Source:** \`${effectiveSource}\``,
                            `**Curated seeds:** ${seeds.length ? seeds.join(', ') : 'none'}`,
                            `**Chart fallback:** ${client.config.autoplayChart ? 'enabled' : 'disabled'}`,
                            'Use `/autoplayconfig source:` or `seeds:` to change this guild.',
                        ].join('\n')
                    ),
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const setting = await this.currentSetting(client, guild.id);

        let source: AutoplaySource | undefined;
        let seedsInput: string | undefined;
        let reset = false;

        if (ctx.isInteraction) {
            const options = ctx.interaction?.options;
            const rawSource = options?.getString('source') ?? undefined;
            seedsInput = options?.getString('seeds')?.trim() || undefined;
            reset = options?.getBoolean('reset') ?? false;
            if (rawSource) {
                if (!SOURCES.includes(rawSource as AutoplaySource)) {
                    return await ctx.sendMessage({
                        embeds: [
                            client
                                .embed()
                                .setColor(client.color.red)
                                .setDescription('Source must be `chart`, `curated`, or `legacy`.'),
                        ],
                    });
                }
                source = rawSource as AutoplaySource;
            }
        } else {
            if (args[0]?.toLowerCase() === 'reset') reset = true;
            else if (SOURCES.includes(args[0] as AutoplaySource)) source = args[0] as AutoplaySource;
            const seedArgs = source ? args.slice(1) : args;
            seedsInput = seedArgs.join(' ').trim() || undefined;
        }

        if (reset) {
            await client.db.deleteAutoplaySetting(guild.id);
            return await this.show(client, ctx, null);
        }

        if (!source && !seedsInput) return await this.show(client, ctx, setting);

        const seeds = seedsInput
            ? seedsInput
                  .split(',')
                  .map(seed => seed.trim())
                  .filter(Boolean)
                  .slice(0, 10)
            : undefined;
        if (seedsInput && !seeds?.length) {
            return await ctx.sendMessage({
                embeds: [
                    client.embed().setColor(client.color.red).setDescription('Provide at least one seed.'),
                ],
            });
        }

        const nextSource = source ?? (seeds?.length ? 'curated' : setting?.source) ?? 'chart';
        const nextSeeds = seeds?.join(', ') ?? setting?.seeds ?? client.config.autoplaySeeds.join(', ');
        await client.db.setAutoplaySetting(guild.id, { source: nextSource, seeds: nextSeeds });
        return await this.show(client, ctx, await this.currentSetting(client, guild.id));
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
