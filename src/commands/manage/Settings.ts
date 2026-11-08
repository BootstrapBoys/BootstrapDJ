import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { AUTOPLAY_FIELDS, DEFAULTS, isKnownSetting } from '../../lib/SettingsSchema.js';

type Field = { key: string; value: string; reset: boolean };

const VALUE_LIMIT = 200;

export default class Settings extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'settings',
            description: {
                content: 'View or change per-guild bot settings',
                usage: 'settings [key] [value]',
                examples: ['settings', 'settings defaultvolume 80'],
            },
            category: 'config',
            aliases: ['config', 'guildsettings'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [
                {
                    name: 'key',
                    description: 'Setting name; omit to list all',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'value',
                    description: 'New value; omit to inspect the setting',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'reset',
                    description: 'Reset every setting for this guild',
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        });
    }

    private read(ctx: Context, args: string[]): Field {
        if (ctx.isInteraction && ctx.interaction) {
            return {
                key: (ctx.interaction.options.getString('key') ?? '').trim().toLowerCase(),
                value: (ctx.interaction.options.getString('value') ?? '').trim(),
                reset: ctx.interaction.options.getBoolean('reset') ?? false,
            };
        }
        return {
            key: (args[0] ?? '').trim().toLowerCase(),
            value: args.slice(1).join(' ').trim(),
            reset: (args[0] ?? '').toLowerCase() === 'reset',
        };
    }

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.red).setDescription(text)],
        });
    }

    private async overview(
        client: BootstrapClient,
        ctx: Context,
        guildId: string
    ): Promise<unknown> {
        const values = await client.db.getGuildSettings(guildId);
        const autoplay = await client.db.getAutoplaySetting(guildId).catch(() => null);
        const lines = Object.entries(DEFAULTS)
            .filter(([name]) => name !== 'autoplaysource' && name !== 'autoplayseeds')
            .map(([name, fallback]) => {
                const current = values[name] ?? fallback;
                return `**${name}**: \`${current}\`${values[name] ? '' : ' *(default)*'}`;
            });
        lines.push(
            `**autoplaysource**: \`${autoplay?.source ?? 'environment default'}\``,
            `**autoplayseeds**: \`${autoplay?.seeds || client.config.autoplaySeeds.join(', ') || 'none'}\``
        );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Guild settings')
                    .setDescription(lines.join('\n')),
            ],
        });
    }

    private async autoplay(
        client: BootstrapClient,
        ctx: Context,
        guildId: string,
        key: string,
        value: string
    ): Promise<unknown> {
        const current = await client.db.getAutoplaySetting(guildId).catch(() => null);
        if (!value) {
            const source = current?.source ?? 'environment default';
            const seeds = current?.seeds || client.config.autoplaySeeds.join(', ') || 'none';
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle('Autoplay settings')
                        .setDescription(
                            `**source**: \`${source}\`\n**seeds**: \`${seeds}\`\n**legacy value**: \`${
                                client.config.autoplaySeed || 'none'
                            }\``
                        ),
                ],
            });
        }

        if (key === 'autoplayreset') {
            await client.db.deleteAutoplaySetting(guildId);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.green)
                        .setDescription('Autoplay override removed.'),
                ],
            });
        }

        if (key === 'autoplaysource') {
            if (!['chart', 'curated', 'legacy'].includes(value)) {
                return await this.fail(
                    client,
                    ctx,
                    'Source must be `chart`, `curated`, or `legacy`.'
                );
            }
            await client.db.setAutoplaySetting(guildId, {
                source: value,
                seeds: current?.seeds ?? client.config.autoplaySeeds.join(', '),
            });
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.green)
                        .setDescription(`Autoplay source set to **${value}**.`),
                ],
            });
        }

        const seeds = value
            .split(',')
            .map(seed => seed.trim())
            .filter(Boolean)
            .slice(0, 10);
        if (seeds.length === 0) return await this.fail(client, ctx, 'Provide at least one seed.');
        await client.db.setAutoplaySetting(guildId, { source: 'curated', seeds: seeds.join(', ') });
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(`Autoplay seeds set to **${seeds.join(', ')}**.`),
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const field = this.read(ctx, args);

        if (field.reset) {
            const removed = await client.db.resetGuildSettings(guild.id);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.green)
                        .setDescription(
                            `Reset ${removed} guild setting${removed === 1 ? '' : 's'}.`
                        ),
                ],
            });
        }

        if (!field.key) return await this.overview(client, ctx, guild.id);
        if (!isKnownSetting(field.key)) {
            return await this.fail(
                client,
                ctx,
                `Unknown setting. Use one of: ${Object.keys(DEFAULTS).join(', ')}.`
            );
        }

        const key = field.key;
        if (AUTOPLAY_FIELDS.has(key)) {
            return await this.autoplay(client, ctx, guild.id, key, field.value);
        }

        if (!field.value) {
            const current = (await client.db.getGuildSetting(guild.id, key)) ?? DEFAULTS[key];
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(`**${key}**: \`${current}\``),
                ],
            });
        }

        if (field.value.length > VALUE_LIMIT)
            return await this.fail(client, ctx, 'That value is too long.');
        if (key === 'ephemeral' && field.value !== 'true' && field.value !== 'false') {
            return await this.fail(
                client,
                ctx,
                '`ephemeral` must be `true` (private) or `false` (public).'
            );
        }

        await client.db.setGuildSetting(guild.id, key, field.value);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(`Set **${key}** to \`${field.value}\`.`),
            ],
        });
    }
}
