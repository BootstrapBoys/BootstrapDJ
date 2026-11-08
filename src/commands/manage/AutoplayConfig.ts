import { ApplicationCommandOptionType, GuildMember, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

type AutoplaySource = 'chart' | 'curated' | 'legacy';
type SettingRow = Awaited<ReturnType<BootstrapClient['db']['getAutoplaySetting']>>;
type Input = { source?: AutoplaySource; seeds?: string; reset: boolean };

const SOURCES: readonly AutoplaySource[] = ['chart', 'curated', 'legacy'];

function isSource(value: string): value is AutoplaySource {
    return (SOURCES as readonly string[]).includes(value);
}

function splitSeeds(value: string): string[] {
    return value
        .split(',')
        .map(seed => seed.trim())
        .filter(Boolean)
        .slice(0, 10);
}

export default class AutoplayConfig extends Command {
    public constructor(client: BootstrapClient) {
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
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
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

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({ embeds: [client.embed().setColor(client.color.red).setDescription(text)] });
    }

    /** Server managers and configured DJ roles may change the policy. */
    private async canConfigure(client: BootstrapClient, ctx: Context, guildId: string): Promise<boolean> {
        const member = ctx.member;
        if (!(member instanceof GuildMember)) return false;
        if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
        const roles = await client.db.getRoles(guildId);
        if (roles.length === 0) return false;
        const configured = new Set(roles.map(role => role.roleId));
        return member.roles.cache.some(role => configured.has(role.id));
    }

    private readInput(ctx: Context, args: string[]): Input {
        if (ctx.isInteraction && ctx.interaction) {
            const raw = ctx.interaction.options.getString('source');
            return {
                source: raw && isSource(raw) ? raw : undefined,
                seeds: ctx.interaction.options.getString('seeds')?.trim() || undefined,
                reset: ctx.interaction.options.getBoolean('reset') ?? false,
            };
        }

        const first = (args[0] ?? '').toLowerCase();
        if (first === 'reset') return { reset: true };
        const source = isSource(first) ? first : undefined;
        const rest = source ? args.slice(1) : args;
        return { source, seeds: rest.join(' ').trim() || undefined, reset: false };
    }

    private async show(client: BootstrapClient, ctx: Context, setting: SettingRow | null): Promise<unknown> {
        const envSeeds = client.config.autoplaySeeds;
        const storedSeeds = splitSeeds(setting?.seeds ?? '');
        const fallback: AutoplaySource = client.config.autoplayChart
            ? 'chart'
            : storedSeeds.length > 0 || envSeeds.length > 0
              ? 'curated'
              : 'legacy';
        const source = (setting?.source as AutoplaySource | undefined) ?? fallback;
        const seeds = storedSeeds.length > 0 ? storedSeeds : envSeeds;

        const labels: Record<AutoplaySource, { name: string; order: string }> = {
            chart: { name: 'Deezer global chart', order: 'chart → curated → legacy' },
            curated: { name: 'Curated search seeds', order: 'curated → legacy' },
            legacy: { name: 'Legacy AUTOPLAY_SEED', order: 'legacy only' },
        };
        const label = labels[source] ?? labels.legacy;
        const chartState = source === 'chart' ? 'active' : 'not used by this source';
        const seedHint = source === 'curated' ? ' (search text, not playlist URLs)' : '';
        const lines = [
            `**Source:** \`${source}\` — ${label.name}`,
            `**Scope:** ${setting ? 'this server (override)' : 'environment default'}`,
            `**Cold-start order:** ${label.order}`,
            `**Chart:** Deezer global chart, explicit tracks filtered — ${chartState}`,
            '**What chart is:** a fixed Deezer global chart, not your playlists or search seeds.',
            `**Curated seeds:** ${seeds.length > 0 ? seeds.join(', ') : 'none'}${seedHint}`,
            `**Legacy value:** \`${client.config.autoplaySeed || 'none'}\``,
            'Use `/autoplayconfig source:` or `seeds:` to change this server, or `reset:true` to clear the override.',
        ];
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Autoplay cold-start configuration')
                    .setDescription(lines.join('\n')),
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        if (!(await this.canConfigure(client, ctx, guild.id))) {
            return await this.fail(
                client,
                ctx,
                'You need the DJ role or Manage Server to change autoplay settings.'
            );
        }

        const setting = await client.db.getAutoplaySetting(guild.id).catch(() => null);
        const input = this.readInput(ctx, args);

        if (ctx.isInteraction && input.source === undefined) {
            const raw = ctx.interaction?.options.getString('source');
            if (raw) return await this.fail(client, ctx, 'Source must be `chart`, `curated`, or `legacy`.');
        }

        if (input.reset) {
            await client.db.deleteAutoplaySetting(guild.id);
            return await this.show(client, ctx, null);
        }
        if (!input.source && !input.seeds) return await this.show(client, ctx, setting);

        const seeds = input.seeds ? splitSeeds(input.seeds) : undefined;
        if (input.seeds && !seeds?.length) {
            return await this.fail(client, ctx, 'Provide at least one seed.');
        }

        const source = input.source ?? (seeds?.length ? 'curated' : (setting?.source as AutoplaySource | undefined)) ?? 'chart';
        const persisted = seeds?.join(', ') ?? setting?.seeds ?? client.config.autoplaySeeds.join(', ');
        await client.db.setAutoplaySetting(guild.id, { source, seeds: persisted });
        return await this.show(client, ctx, await client.db.getAutoplaySetting(guild.id).catch(() => null));
    }
}
