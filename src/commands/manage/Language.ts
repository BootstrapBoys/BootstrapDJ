import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import {
    isSupportedLanguage,
    languageName,
    localizedDescriptions,
    resolveLanguage,
    SUPPORTED_LANGUAGES,
} from '../../lib/i18n.js';

function availableLanguages(): string {
    return SUPPORTED_LANGUAGES.map(language => languageName(language)).join(', ');
}

export default class Language extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'language',
            description: {
                content: 'View or change the language for this server',
                usage: 'language [set <locale> | reset]',
                examples: ['language', 'language set en-GB', 'language reset'],
            },
            descriptionLocalizations: localizedDescriptions('commands:language.description'),
            category: 'config',
            aliases: ['lang'],
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
                    name: 'language',
                    description: 'Language to use',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: SUPPORTED_LANGUAGES.map(language => ({
                        name: languageName(language),
                        value: language,
                    })),
                },
                {
                    name: 'reset',
                    description: 'Reset to the default language',
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        });
    }

    private reply(client: BootstrapClient, ctx: Context, description: string): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription(description)],
        });
    }

    private current(client: BootstrapClient, ctx: Context): Promise<unknown> {
        return this.reply(
            client,
            ctx,
            ctx.t('common:language.current', { language: languageName(ctx.locale) })
        );
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[] = []): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;

        if (ctx.isInteraction && ctx.interaction) {
            if (ctx.interaction.options.getBoolean('reset') === true) {
                return await this.reset(client, ctx, guild.id);
            }
            const requested = ctx.interaction.options.getString('language');
            if (!requested) return await this.current(client, ctx);
            return await this.set(client, ctx, guild.id, requested);
        }

        const action = (args[0] ?? '').toLowerCase();
        if (!action) return await this.current(client, ctx);
        if (action === 'reset') return await this.reset(client, ctx, guild.id);
        if (action === 'set') {
            return await this.set(client, ctx, guild.id, args[1] ?? '');
        }
        return await this.set(client, ctx, guild.id, args[0]);
    }

    private async set(
        client: BootstrapClient,
        ctx: Context,
        guildId: string,
        requested: string
    ): Promise<unknown> {
        if (!isSupportedLanguage(requested)) {
            return await this.reply(
                client,
                ctx,
                ctx.t('common:language.invalid', { languages: availableLanguages() })
            );
        }
        const language = resolveLanguage(requested);
        await client.db.setGuildSetting(guildId, 'language', language);
        ctx.setLanguage(language);
        return await this.reply(
            client,
            ctx,
            ctx.t('common:language.set', { language: languageName(language) })
        );
    }

    private async reset(client: BootstrapClient, ctx: Context, guildId: string): Promise<unknown> {
        const language = client.config.defaultLanguage;
        await client.db.setGuildSetting(guildId, 'language', language);
        ctx.setLanguage(language);
        return await this.reply(
            client,
            ctx,
            ctx.t('common:language.reset', { language: languageName(language) })
        );
    }
}
