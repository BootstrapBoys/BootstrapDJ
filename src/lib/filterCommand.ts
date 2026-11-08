import type { CommandOptions } from '../core/Command.js';
import type { ApplicationCommandOption, PermissionsString } from 'discord.js';

import { BootstrapClient, Command, Context, Dispatcher } from '../core/index.js';
import { resolvePlayer } from './PlayerResolver.js';
import { replyFail, replyOk } from './reply.js';

export type FilterRunContext = {
    client: BootstrapClient;
    ctx: Context;
    player: Dispatcher;
    args: string[];
};

export interface FilterDefinition {
    name: string;
    description: CommandOptions['description'];
    aliases?: string[];
    user?: PermissionsString[];
    active?: boolean;
    args?: boolean;
    options?: ApplicationCommandOption[];
    /** Require a loaded track, not merely a player (parameter filters act on the live track). */
    requireCurrent?: boolean;
    /** Omit for a silent no-player return; the default posts the standard error. */
    missingPlayer?: string | null;
    run: (input: FilterRunContext) => Promise<unknown>;
}

const NO_MUSIC = 'There is no music playing in this server.';
const CLIENT_PERMISSIONS: PermissionsString[] = ['SendMessages', 'ViewChannel', 'EmbedLinks'];

/**
 * Build a filter command from a small behavior descriptor.
 *
 * All filter commands share the same guild guard, player lookup, permission
 * shape, and reply lifecycle. Keeping that scaffolding here means individual
 * filters only describe their DSP transition and user-facing copy.
 */
export function defineFilterCommand(definition: FilterDefinition): typeof Command {
    return class extends Command {
        public constructor(client: BootstrapClient) {
            super(client, {
                name: definition.name,
                description: definition.description,
                category: 'filters',
                aliases: definition.aliases ?? [],
                cooldown: 3,
                args: definition.args ?? false,
                player: { voice: true, dj: true, active: definition.active ?? true, djPerm: null },
                permissions: {
                    dev: false,
                    client: CLIENT_PERMISSIONS,
                    user: definition.user ?? ['ManageGuild'],
                },
                slashCommand: false,
                options: definition.options ?? [],
            });
        }

        public async run(
            client: BootstrapClient,
            ctx: Context,
            args: string[]
        ): Promise<unknown> {
            if (!ctx.guild) {
                return await ctx.sendMessage({ content: 'This command only works in a server.' });
            }
            const player = await resolvePlayer(
                client,
                ctx.guild.id,
                ctx.voiceChannel,
                ctx.guild.channels?.cache?.get(ctx.channelId) ?? null
            );
            if (!player || (definition.requireCurrent && !player.current)) {
                if (definition.missingPlayer === null) return;
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription(definition.missingPlayer ?? NO_MUSIC),
                    ],
                });
            }
            return await definition.run({ client, ctx, player, args });
        }
    };
}

/** Toggle a filter and report the resulting state. */
export function toggleFilter(
    key: string,
    label: string,
    enable: (player: Dispatcher) => void,
    disable: (player: Dispatcher) => void
): FilterDefinition['run'] {
    return async ({ client, ctx, player }) => {
        const active = player.filters.includes(key);
        if (active) {
            disable(player);
            player.filters.splice(player.filters.indexOf(key), 1);
        } else {
            enable(player);
            player.filters.push(key);
        }
        return await ctx.sendMessage({
            embeds: [
                {
                    description: `${label} filter has been ${active ? 'disabled' : 'enabled'}`,
                    color: client.color.main,
                },
            ],
        });
    };
}

export interface NumericFilterOptions {
    key: string;
    min: number;
    max: number;
    /** Copy shown when the argument is not a number at all. */
    invalid: string;
    /** Copy shown when the number falls outside [min, max]. */
    outOfRange: string;
    apply: (player: Dispatcher, value: number) => void;
    success: (value: number) => string;
}

/** Shared run body for filters that take one bounded numeric argument. */
export function numericFilter(options: NumericFilterOptions): FilterDefinition['run'] {
    return async ({ client, ctx, player, args }) => {
        const value = Number(args[0]);
        if (!Number.isFinite(value)) return await replyFail(client, ctx, options.invalid);
        if (value < options.min || value > options.max) {
            return await replyFail(client, ctx, options.outOfRange);
        }

        options.apply(player, value);
        if (!player.filters.includes(options.key)) player.filters.push(options.key);
        player.filterValues[options.key] = value;
        return await replyOk(client, ctx, options.success(value));
    };
}
