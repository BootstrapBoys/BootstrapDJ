import type { CommandOptions } from '../core/Command.js';
import type { ApplicationCommandOption, PermissionsString } from 'discord.js';

import { BootstrapClient, Command, Context, Dispatcher } from '../core/index.js';

export type MusicRunContext = {
    client: BootstrapClient;
    ctx: Context;
    player: Dispatcher | undefined;
    args: string[];
};

export interface MusicCommandDefinition {
    name: string;
    description: CommandOptions['description'];
    aliases?: string[];
    args?: boolean;
    dj?: boolean;
    active?: boolean;
    user?: PermissionsString[];
    options?: ApplicationCommandOption[];
    slashCommand?: boolean;
    /** Defaults to true; Join/Leave opt out because they create or destroy the player. */
    requirePlayer?: boolean;
    run: (input: MusicRunContext) => Promise<unknown>;
}

const CLIENT_PERMISSIONS: PermissionsString[] = ['SendMessages', 'ViewChannel', 'EmbedLinks'];
const NO_PLAYER = 'There is no music playing in this server.';

/**
 * Build a standard music command from one behavior function.
 *
 * Guild resolution, player lookup, permission metadata, and slash plumbing are
 * identical across the control surface; this factory keeps those concerns in
 * one place and leaves each file responsible only for its action.
 */
export function defineMusicCommand(definition: MusicCommandDefinition): typeof Command {
    return class extends Command {
        public constructor(client: BootstrapClient) {
            super(client, {
                name: definition.name,
                description: definition.description,
                category: 'music',
                aliases: definition.aliases ?? [],
                cooldown: 3,
                args: definition.args ?? false,
                player: {
                    voice: true,
                    dj: definition.dj ?? true,
                    active: definition.active ?? true,
                    djPerm: null,
                },
                permissions: {
                    dev: false,
                    client: CLIENT_PERMISSIONS,
                    user: definition.user ?? [],
                },
                slashCommand: definition.slashCommand ?? true,
                options: definition.options ?? [],
            });
        }

        public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
            if (!ctx.guild) return;
            const player = client.queue.get(ctx.guild.id);
            if (!player && (definition.requirePlayer ?? true)) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription(NO_PLAYER)],
                });
            }
            return await definition.run({ client, ctx, player, args });
        }
    };
}
