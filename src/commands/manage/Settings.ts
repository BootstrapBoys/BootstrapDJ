import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import {
    isSupportedLanguage,
    languageName,
    resolveLanguage,
    SUPPORTED_LANGUAGES,
} from '../../lib/i18n.js';
import { AUTOPLAY_FIELDS, DEFAULTS, isKnownSetting } from '../../lib/SettingsSchema.js';
import { tr } from '../../lib/i18nContext.js';

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

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:settings.${key}`, variables);
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
                return `**${name}**: \`${current}\`${values[name] ? '' : this.copy(ctx, 'defaultSuffix')}`;
            });
        lines.push(
            `**autoplaysource**: \`${autoplay?.source ?? this.copy(ctx, 'sourceEnv')}\``,
            `**autoplayseeds**: \`${autoplay?.seeds || client.config.autoplaySeeds.join(', ') || this.copy(ctx, 'none')}\``
        );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(this.copy(ctx, 'guildTitle'))
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
            const source = current?.source ?? this.copy(ctx, 'sourceEnv');
            const seeds =
                current?.seeds || client.config.autoplaySeeds.join(', ') || this.copy(ctx, 'none');
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle(this.copy(ctx, 'autoplayTitle'))
                        .setDescription(
                            `**${this.copy(ctx, 'sourceLabel')}**: \`${source}\`\n**${this.copy(ctx, 'seedsLabel')}**: \`${seeds}\`\n**${this.copy(ctx, 'legacyLabel')}**: \`${
                                client.config.autoplaySeed || this.copy(ctx, 'none')
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
                        .setDescription(this.copy(ctx, 'autoplayRemoved')),
                ],
            });
        }

        if (key === 'autoplaysource') {
            if (!['chart', 'curated', 'legacy'].includes(value)) {
                return await this.fail(client, ctx, this.copy(ctx, 'sourceInvalid'));
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
                        .setDescription(this.copy(ctx, 'sourceSet', { source: value })),
                ],
            });
        }

        const seeds = value
            .split(',')
            .map(seed => seed.trim())
            .filter(Boolean)
            .slice(0, 10);
        if (seeds.length === 0) return await this.fail(client, ctx, this.copy(ctx, 'provideSeed'));
        await client.db.setAutoplaySetting(guildId, { source: 'curated', seeds: seeds.join(', ') });
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(this.copy(ctx, 'seedsSet', { seeds: seeds.join(', ') })),
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
                            this.copy(ctx, removed === 1 ? 'resetOne' : 'resetMany', {
                                count: removed,
                            })
                        ),
                ],
            });
        }

        if (!field.key) return await this.overview(client, ctx, guild.id);
        if (!isKnownSetting(field.key)) {
            return await this.fail(
                client,
                ctx,
                this.copy(ctx, 'unknownSetting', { keys: Object.keys(DEFAULTS).join(', ') })
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
            return await this.fail(client, ctx, this.copy(ctx, 'valueTooLong'));
        if (key === 'ephemeral' && field.value !== 'true' && field.value !== 'false') {
            return await this.fail(client, ctx, this.copy(ctx, 'ephemeralInvalid'));
        }
        if (key === 'language') {
            if (!isSupportedLanguage(field.value)) {
                return await this.fail(
                    client,
                    ctx,
                    this.copy(ctx, 'languageChoices', {
                        languages: SUPPORTED_LANGUAGES.map(language => languageName(language)).join(
                            ', '
                        ),
                    })
                );
            }
            field.value = resolveLanguage(field.value);
        }

        await client.db.setGuildSetting(guild.id, key, field.value);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(this.copy(ctx, 'setValue', { key, value: field.value })),
            ],
        });
    }
}
