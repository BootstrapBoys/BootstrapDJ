import type { ApplicationCommandOption, LocalizationMap, PermissionsString } from 'discord.js';

import type BootstrapClient from './BootstrapClient.js';

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

const DEFAULT_CLIENT_PERMISSIONS: PermissionsString[] = [
    'SendMessages',
    'ViewChannel',
    'EmbedLinks',
];

const DEFAULT_COPY: CommandCopy = Object.freeze({
    content: 'No description provided',
    usage: 'No usage provided',
    examples: [''],
});

function firstString(...values: Array<string | undefined>): string | null {
    for (const value of values) if (value) return value;
    return null;
}

function copyOf(input: CommandOptions['description']): CommandCopy {
    const content = firstString(input?.content) ?? DEFAULT_COPY.content;
    const usage = firstString(input?.usage) ?? DEFAULT_COPY.usage;
    const examples = input?.examples?.filter(example => example.length > 0) ?? [];
    return {
        content,
        usage,
        examples: examples.length > 0 ? examples : [...DEFAULT_COPY.examples],
    };
}

function playerRules(input: CommandOptions['player']): CommandPlayerRules {
    return {
        voice: input?.voice === true,
        dj: input?.dj === true,
        active: input?.active === true,
        djPerm: firstString(input?.djPerm ?? undefined),
    };
}

function permissionRules(input: CommandOptions['permissions']): CommandPermissions {
    return {
        dev: input?.dev === true,
        client: input?.client ? [...input.client] : [...DEFAULT_CLIENT_PERMISSIONS],
        user: input?.user ? [...input.user] : [],
    };
}

/**
 * Command contract.
 *
 * Metadata is normalized once, in the constructor, so the gate, help page, and
 * slash registrar can read plain fields. Subclasses own behaviour only.
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
        this.description = copyOf(options.description);
        this.descriptionLocalizations = options.descriptionLocalizations ?? null;
        this.aliases = options.aliases ? [...options.aliases] : [];
        this.cooldown = options.cooldown || 3;
        this.args = options.args === true;
        this.player = playerRules(options.player);
        this.permissions = permissionRules(options.permissions);
        this.slashCommand = options.slashCommand === true;
        this.defer = options.defer === true;
        this.ephemeral = options.ephemeral ?? true;
        this.options = options.options ? [...options.options] : [];
        this.category = options.category ?? 'general';
    }

    /** Subclasses replace this; the default keeps metadata-only commands safe. */
    public async run(
        _client: BootstrapClient,
        _message: unknown,
        _args: string[]
    ): Promise<unknown> {
        return await Promise.resolve();
    }
}
