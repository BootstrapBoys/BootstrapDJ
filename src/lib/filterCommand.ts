import type { CommandOptions } from '../core/Command.js';
import type { ApplicationCommandOption, PermissionsString } from 'discord.js';

import { BootstrapClient, Command, Context, Dispatcher } from '../core/index.js';
import { tr } from './i18nContext.js';
import { resolvePlayer } from './PlayerResolver.js';
import { replyFail, replyOk } from './reply.js';

/** User-facing copy resolved in the guild's language when the reply is sent. */
export type FilterCopy = (ctx: Context) => string;

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
    missingPlayer?: FilterCopy | null;
    run: (input: FilterRunContext) => Promise<unknown>;
}

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

        public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
            if (!ctx.guild) {
                return await ctx.sendMessage({ content: tr(ctx, 'longtail:filters.guildOnly') });
            }
            const player = await resolvePlayer(
                client,
                ctx.guild.id,
                ctx.voiceChannel,
                ctx.guild.channels?.cache?.get(ctx.channelId) ?? null
            );
            if (!player || (definition.requireCurrent && !player.current)) {
                if (definition.missingPlayer === null) return;
                const missing = definition.missingPlayer
                    ? definition.missingPlayer(ctx)
                    : tr(ctx, 'longtail:filters.noMusic');
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription(missing)],
                });
            }
            return await definition.run({ client, ctx, player, args });
        }
    };
}

export type FilterEffect = (player: Dispatcher) => void | Promise<unknown>;
export type NumericFilterEffect = (player: Dispatcher, value: number) => void | Promise<unknown>;

/** Toggle a filter and report the resulting state. */
export function toggleFilter(
    key: string,
    label: string,
    enable: FilterEffect,
    disable: FilterEffect
): FilterDefinition['run'] {
    return async ({ client, ctx, player }) => {
        const active = player.filters.includes(key);
        try {
            // Lavalink writes are async; the reply must not claim success
            // before the player accepted the change.
            if (active) {
                await disable(player);
                player.filters.splice(player.filters.indexOf(key), 1);
            } else {
                await enable(player);
                player.filters.push(key);
            }
        } catch (error) {
            client.logger.warn(`[filter] ${key} toggle failed: ${error}`);
            return await replyFail(
                client,
                ctx,
                tr(ctx, 'longtail:filters.updateFailed', { filter: label })
            );
        }
        return await ctx.sendMessage({
            embeds: [
                {
                    description: tr(
                        ctx,
                        active
                            ? 'longtail:filters.toggleDisabled'
                            : 'longtail:filters.toggleEnabled',
                        { label }
                    ),
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
    invalid: FilterCopy;
    /** Copy shown when the number falls outside [min, max]. */
    outOfRange: FilterCopy;
    apply: NumericFilterEffect;
    success: (value: number, ctx: Context) => string;
}

/** Shared run body for filters that take one bounded numeric argument. */
export function numericFilter(options: NumericFilterOptions): FilterDefinition['run'] {
    return async ({ client, ctx, player, args }) => {
        const value = Number(args[0]);
        if (!Number.isFinite(value)) return await replyFail(client, ctx, options.invalid(ctx));
        if (value < options.min || value > options.max) {
            return await replyFail(client, ctx, options.outOfRange(ctx));
        }

        try {
            await options.apply(player, value);
        } catch (error) {
            client.logger.warn(`[filter] ${options.key} write failed: ${error}`);
            return await replyFail(
                client,
                ctx,
                tr(ctx, 'longtail:filters.updateFailed', { filter: options.key })
            );
        }
        if (!player.filters.includes(options.key)) player.filters.push(options.key);
        player.filterValues[options.key] = value;
        return await replyOk(client, ctx, options.success(value, ctx));
    };
}
