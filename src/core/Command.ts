import type BootstrapClient from './BootstrapClient.js';
import type { ApplicationCommandOption, LocalizationMap, PermissionsString } from 'discord.js';

/** Player preconditions declared by a command and enforced before execution. */
export interface CommandPlayerRules {
    voice: boolean;
    dj: boolean;
    active: boolean;
    djPerm: string | null;
}

/** Ownership and permission rules for a command. */
export interface CommandPermissions {
    dev: boolean;
    client: PermissionsString[];
    user: PermissionsString[];
}

/** User-facing command copy consumed by help and slash registration. */
export interface CommandCopy {
    content: string;
    usage: string;
    examples: string[];
}

/** Declarative constructor input shared by every command. */
export interface CommandOptions {
    name: string;
    nameLocalizations?: LocalizationMap;
    description?: Partial<CommandCopy> & { content: string; usage: string };
    descriptionLocalizations?: LocalizationMap;
    aliases?: string[];
    cooldown?: number;
    args?: boolean;
    player?: CommandPlayerRules;
    permissions?: Partial<CommandPermissions>;
    slashCommand?: boolean;
    defer?: boolean;
    ephemeral?: boolean;
    options?: ApplicationCommandOption[];
    category?: string;
}

const FALLBACK_COPY: CommandCopy = {
    content: 'No description provided',
    usage: 'No usage provided',
    examples: [''],
};

function normalizeCopy(input: CommandOptions['description']): CommandCopy {
    return {
        content: input?.content || FALLBACK_COPY.content,
        usage: input?.usage || FALLBACK_COPY.usage,
        examples: input?.examples?.length ? [...input.examples] : [...FALLBACK_COPY.examples],
    };
}

function normalizePlayerRules(input: CommandOptions['player']): CommandPlayerRules {
    return {
        voice: Boolean(input?.voice),
        dj: Boolean(input?.dj),
        active: Boolean(input?.active),
        djPerm: input?.djPerm ?? null,
    };
}

function normalizePermissions(input: CommandOptions['permissions']): CommandPermissions {
    return {
        dev: Boolean(input?.dev),
        client: input?.client ?? ['SendMessages', 'ViewChannel', 'EmbedLinks'],
        user: input?.user ?? [],
    };
}

/**
 * Base contract for commands.
 *
 * A subclass supplies metadata once and implements `run`. The command gate and
 * slash registrar consume the normalized public fields, so they never need to
 * know which concrete command they are handling.
 */
export default class Command {
    public client: BootstrapClient;
    public name: string;
    public nameLocalizations: LocalizationMap | null;
    public description: CommandCopy;
    public descriptionLocalizations: LocalizationMap | null;
    public aliases: string[];
    public cooldown: number;
    public args: boolean;
    public player: CommandPlayerRules;
    public permissions: CommandPermissions;
    public slashCommand: boolean;
    public defer: boolean;
    /** Slash replies are private unless a command opts out. */
    public ephemeral: boolean;
    public options: ApplicationCommandOption[];
    public category: string | null;

    public constructor(client: BootstrapClient, options: CommandOptions) {
        this.client = client;
        this.name = options.name;
        this.nameLocalizations = options.nameLocalizations ?? null;
        this.description = normalizeCopy(options.description);
        this.descriptionLocalizations = options.descriptionLocalizations ?? null;
        this.aliases = options.aliases ? [...options.aliases] : [];
        this.cooldown = options.cooldown || 3;
        this.args = Boolean(options.args);
        this.player = normalizePlayerRules(options.player);
        this.permissions = normalizePermissions(options.permissions);
        this.slashCommand = Boolean(options.slashCommand);
        this.defer = Boolean(options.defer);
        this.ephemeral = options.ephemeral ?? true;
        this.options = options.options ?? [];
        this.category = options.category ?? 'general';
    }

    /** Subclasses replace this; the default keeps metadata-only commands safe. */
    public async run(_client: BootstrapClient, _message: unknown, _args: string[]): Promise<unknown> {
        return await Promise.resolve();
    }
}
