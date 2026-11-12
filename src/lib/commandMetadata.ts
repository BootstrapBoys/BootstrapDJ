import { ApplicationCommandOptionType } from 'discord.js';
import type {
    APIApplicationCommandAttachmentOption,
    APIApplicationCommandBasicOption,
    APIApplicationCommandChannelOption,
    APIApplicationCommandIntegerOption,
    APIApplicationCommandNumberOption,
    APIApplicationCommandOption,
    APIApplicationCommandOptionChoice,
    APIApplicationCommandStringOption,
    APIApplicationCommandSubcommandGroupOption,
    APIApplicationCommandSubcommandOption,
    ApplicationCommandAttachmentOption,
    ApplicationCommandChannelOption,
    ApplicationCommandOption,
    ApplicationCommandOptionChoiceData,
    ApplicationCommandSubCommand,
    ApplicationCommandSubGroup,
    LocalizationMap,
} from 'discord.js';

import type Command from '../core/Command.js';

import { DEFAULT_LANGUAGE, hasTranslation, localizedDescriptions, translate } from './i18n.js';

/**
 * Command metadata is global to the application, so Discord localizations come
 * from the catalogs rather than the guild locale. The English catalog remains
 * the source of truth; a missing entry leaves the constructor fallback intact.
 */
export function applyCommandMetadata(command: Command): void {
    const base = `commands:metadata.${command.name}`;
    const descriptionKey = `${base}.description`;
    if (hasTranslation(descriptionKey)) {
        command.description.content = translate(descriptionKey, DEFAULT_LANGUAGE);
        const localizations = localizedDescriptions(descriptionKey);
        if (Object.keys(localizations).length) {
            command.descriptionLocalizations = localizations;
        }
    }

    for (const option of command.options) applyOptionMetadata(option, `${base}.options`);
}

/**
 * Subcommand options are nested, so the catalog path mirrors every level
 * (`metadata.<command>.options.<subcommand>.options.<option>`).
 */
function applyOptionMetadata(option: ApplicationCommandOption, baseKey: string): void {
    const key = `${baseKey}.${option.name}`;
    if (hasTranslation(key)) {
        option.description = translate(key, DEFAULT_LANGUAGE);
        const localizations = localizedDescriptions(key);
        if (Object.keys(localizations).length) {
            option.descriptionLocalizations = localizations;
        }
    }
    if ('options' in option && option.options) {
        for (const child of option.options) applyOptionMetadata(child, `${key}.options`);
    }
}

/** Fields every option type shares, in discord.js's camelCase shape. */
interface LocalizableFields {
    name: string;
    description: string;
    required?: boolean;
    nameLocalizations?: LocalizationMap | null;
    descriptionLocalizations?: LocalizationMap | null;
}

/** Discord's REST body, which only accepts the snake_case localization keys. */
interface ApiBase {
    name: string;
    description: string;
    required?: boolean;
    name_localizations?: LocalizationMap;
    description_localizations?: LocalizationMap;
}

function apiBase(option: LocalizableFields): ApiBase {
    const base: ApiBase = { name: option.name, description: option.description };
    if (option.required !== undefined) base.required = option.required;
    if (option.nameLocalizations) base.name_localizations = option.nameLocalizations;
    if (option.descriptionLocalizations) {
        base.description_localizations = option.descriptionLocalizations;
    }
    return base;
}

/** Keep the literal option type instead of widening it to the enum. */
function apiTyped<Type extends ApplicationCommandOptionType>(
    option: LocalizableFields,
    type: Type
): ApiBase & { type: Type } {
    return { ...apiBase(option), type };
}

function apiChoices<Value extends string | number>(
    choices: readonly ApplicationCommandOptionChoiceData<Value>[] | undefined
): APIApplicationCommandOptionChoice<Value>[] {
    if (!choices) return [];
    return choices.map(choice => {
        const mapped: APIApplicationCommandOptionChoice<Value> = {
            name: choice.name,
            value: choice.value,
        };
        if (choice.nameLocalizations) mapped.name_localizations = choice.nameLocalizations;
        return mapped;
    });
}

interface LengthLimits {
    min_length?: number;
    max_length?: number;
}

function apiLengthLimits(option: { minLength?: number; maxLength?: number }): LengthLimits {
    const limits: LengthLimits = {};
    if (option.minLength !== undefined) limits.min_length = option.minLength;
    if (option.maxLength !== undefined) limits.max_length = option.maxLength;
    return limits;
}

interface ValueLimits {
    min_value?: number;
    max_value?: number;
}

function apiValueLimits(option: { minValue?: number; maxValue?: number }): ValueLimits {
    const limits: ValueLimits = {};
    if (option.minValue !== undefined) limits.min_value = option.minValue;
    if (option.maxValue !== undefined) limits.max_value = option.maxValue;
    return limits;
}

interface StringFields extends LocalizableFields {
    minLength?: number;
    maxLength?: number;
    autocomplete?: boolean;
    choices?: readonly ApplicationCommandOptionChoiceData<string>[];
}

function apiStringOption(option: StringFields): APIApplicationCommandStringOption {
    const base = {
        ...apiTyped(option, ApplicationCommandOptionType.String),
        ...apiLengthLimits(option),
    };
    if (option.autocomplete === true) return { ...base, autocomplete: true };
    const choices = apiChoices(option.choices);
    return choices.length ? { ...base, choices } : base;
}

interface NumericFields extends LocalizableFields {
    minValue?: number;
    maxValue?: number;
    autocomplete?: boolean;
    choices?: readonly ApplicationCommandOptionChoiceData<number>[];
}

function apiIntegerOption(option: NumericFields): APIApplicationCommandIntegerOption {
    const base = {
        ...apiTyped(option, ApplicationCommandOptionType.Integer),
        ...apiValueLimits(option),
    };
    if (option.autocomplete === true) return { ...base, autocomplete: true };
    const choices = apiChoices(option.choices);
    return choices.length ? { ...base, choices } : base;
}

function apiNumberOption(option: NumericFields): APIApplicationCommandNumberOption {
    const base = {
        ...apiTyped(option, ApplicationCommandOptionType.Number),
        ...apiValueLimits(option),
    };
    if (option.autocomplete === true) return { ...base, autocomplete: true };
    const choices = apiChoices(option.choices);
    return choices.length ? { ...base, choices } : base;
}

interface ChannelFields extends LocalizableFields {
    channelTypes?: NonNullable<ApplicationCommandChannelOption['channelTypes']>;
}

function apiChannelOption(option: ChannelFields): APIApplicationCommandChannelOption {
    return {
        ...apiTyped(option, ApplicationCommandOptionType.Channel),
        ...(option.channelTypes?.length ? { channel_types: [...option.channelTypes] } : {}),
    };
}

interface AttachmentFields extends LocalizableFields {
    fileTypes?: NonNullable<ApplicationCommandAttachmentOption['fileTypes']>;
}

function apiAttachmentOption(option: AttachmentFields): APIApplicationCommandAttachmentOption {
    return {
        ...apiTyped(option, ApplicationCommandOptionType.Attachment),
        ...(option.fileTypes?.length ? { file_types: [...option.fileTypes] } : {}),
    };
}

type BasicCommandOption = Exclude<
    ApplicationCommandOption,
    ApplicationCommandSubGroup | ApplicationCommandSubCommand
>;

interface SubcommandFields extends LocalizableFields {
    options?: readonly BasicCommandOption[];
}

function apiSubcommandOption(option: SubcommandFields): APIApplicationCommandSubcommandOption {
    return {
        ...apiTyped(option, ApplicationCommandOptionType.Subcommand),
        ...(option.options?.length
            ? { options: option.options.map(child => toApiOption(child)) }
            : {}),
    };
}

interface SubcommandGroupFields extends LocalizableFields {
    options?: readonly ApplicationCommandSubCommand[];
}

function apiSubcommandGroupOption(
    option: SubcommandGroupFields
): APIApplicationCommandSubcommandGroupOption {
    return {
        ...apiTyped(option, ApplicationCommandOptionType.SubcommandGroup),
        ...(option.options?.length
            ? { options: option.options.map(child => apiSubcommandOption(child)) }
            : {}),
    };
}

function toApiOption(option: BasicCommandOption): APIApplicationCommandBasicOption;
function toApiOption(option: ApplicationCommandOption): APIApplicationCommandOption;
/** Convert one camelCase command option into Discord's snake_case REST shape. */
function toApiOption(option: ApplicationCommandOption): APIApplicationCommandOption {
    switch (option.type) {
        case ApplicationCommandOptionType.Subcommand:
            return apiSubcommandOption(option);
        case ApplicationCommandOptionType.SubcommandGroup:
            return apiSubcommandGroupOption(option);
        case ApplicationCommandOptionType.String:
            return apiStringOption(option);
        case ApplicationCommandOptionType.Integer:
            return apiIntegerOption(option);
        case ApplicationCommandOptionType.Number:
            return apiNumberOption(option);
        case ApplicationCommandOptionType.Boolean:
            return apiTyped(option, ApplicationCommandOptionType.Boolean);
        case ApplicationCommandOptionType.User:
            return apiTyped(option, ApplicationCommandOptionType.User);
        case ApplicationCommandOptionType.Channel:
            return apiChannelOption(option);
        case ApplicationCommandOptionType.Role:
            return apiTyped(option, ApplicationCommandOptionType.Role);
        case ApplicationCommandOptionType.Mentionable:
            return apiTyped(option, ApplicationCommandOptionType.Mentionable);
        case ApplicationCommandOptionType.Attachment:
            return apiAttachmentOption(option);
    }
}

/**
 * Serialize every option (recursively) for `PUT /applications/{id}/commands`.
 * discord.js types options with camelCase localization keys; the REST body only
 * accepts snake_case, and an unknown camelCase key makes Discord ignore it.
 */
export function toApiOptions(
    options: readonly ApplicationCommandOption[]
): APIApplicationCommandOption[] {
    return options.map(option => toApiOption(option));
}
