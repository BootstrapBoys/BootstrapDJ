import { ApplicationCommandOption, LocalizationMap, PermissionsString } from 'discord.js';

import BootstrapClient from './BootstrapClient.js';

export default class Command {
    public client: BootstrapClient;
    public name: string;
    public nameLocalizations: LocalizationMap | null;
    public description: {
        content: string | null;
        usage: string | null;
        examples: string[];
    };
    public descriptionLocalizations: LocalizationMap | null;
    public aliases: string[];
    public cooldown: number;
    public args: boolean;
    public player: {
        voice: boolean;
        dj: boolean;
        active: boolean;
        djPerm: string | null;
    };
    public permissions: {
        dev: boolean;
        client: PermissionsString[];
        user: PermissionsString[];
    };
    public slashCommand: boolean;
    public defer: boolean;
    /** Slash replies are ephemeral by default; prefix replies ignore this. */
    public ephemeral: boolean;
    public options: ApplicationCommandOption[];
    public category: string | null;
    constructor(client: BootstrapClient, options: CommandOptions) {
        this.client = client;
        this.name = options.name;
        this.nameLocalizations = options.nameLocalizations ?? null;
        this.description = {
            content: options.description
                ? options.description.content || 'No description provided'
                : 'No description provided',
            usage: options.description
                ? options.description.usage || 'No usage provided'
                : 'No usage provided',
            examples: options.description ? options.description.examples || [''] : [''],
        };
        this.descriptionLocalizations = options.descriptionLocalizations ?? null;
        this.aliases = options.aliases || [];
        this.cooldown = options.cooldown || 3;
        this.args = options.args || false;
        this.player = {
            voice: options.player ? options.player.voice || false : false,
            dj: options.player ? options.player.dj || false : false,
            active: options.player ? options.player.active || false : false,
            djPerm: options.player ? options.player.djPerm || null : null,
        };
        this.permissions = {
            dev: options.permissions ? options.permissions.dev || false : false,
            client: options.permissions
                ? options.permissions.client || []
                : ['SendMessages', 'ViewChannel', 'EmbedLinks'],
            user: options.permissions ? options.permissions.user || [] : [],
        };
        this.slashCommand = options.slashCommand || false;
        this.defer = options.defer || false;
        this.ephemeral = options.ephemeral ?? true;
        this.options = options.options || [];
        this.category = options.category || 'general';
    }
    public async run(_client: BootstrapClient, _message: unknown, _args: string[]): Promise<unknown> {
        return await Promise.resolve();
    }
}

interface CommandOptions {
    name: string;
    nameLocalizations?: LocalizationMap;
    description?: {
        content: string;
        usage: string;
        examples: string[];
    };
    descriptionLocalizations?: LocalizationMap;
    aliases?: string[];
    cooldown?: number;
    args?: boolean;
    player?: {
        voice: boolean;
        dj: boolean;
        active: boolean;
        djPerm: string | null;
    };
    permissions?: {
        dev: boolean;
        client: PermissionsString[];
        user: PermissionsString[];
    };
    slashCommand?: boolean;
    defer?: boolean;
    ephemeral?: boolean;
    options?: ApplicationCommandOption[];
    category?: string;
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
