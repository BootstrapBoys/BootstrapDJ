import type BootstrapClient from '../core/BootstrapClient.js';
import type Command from '../core/Command.js';
import { translate } from './i18n.js';
import {
    ChannelType,
    Collection,
    EmbedBuilder,
    PermissionFlagsBits,
    type PermissionsString,
} from 'discord.js';

/** The parts of a guild member the gate needs, kept structural for tests. */
export interface GateMember {
    id: string;
    roleIds: readonly string[];
    hasPermission(permission: PermissionsString | bigint): boolean;
    voiceChannel: { id: string; type: ChannelType } | null;
}

export interface GateChannel {
    id: string;
    isThread(): boolean;
}

export interface GateInput {
    client: BootstrapClient;
    command: Command;
    guildId: string;
    guildName: string;
    member: GateMember;
    me: GateMember;
    channel: GateChannel;
    canViewChannel: boolean;
    settings: Record<string, string>;
    args: readonly string[];
    /** Prefix uses the typed alias; slash uses the registered command name. */
    commandKey: string;
    isPrefix: boolean;
    /** Resolved guild locale; defaults to the process fallback. */
    language?: string;
}

export interface GateResponse {
    content?: string;
    embeds?: EmbedBuilder[];
}

export type GateResult =
    | { ok: true }
    | {
          ok: false;
          response?: GateResponse;
          /** A silent refusal (missing ViewChannel or failed dev check). */
          silent?: boolean;
          /** Reply by DM instead of in the channel/message. */
          dm?: boolean;
      };

function deny(content: string): GateResult {
    return { ok: false, response: { content } };
}

/**
 * Developer access fails closed. A missing, empty or malformed owner list
 * grants dev-only commands to nobody, so a broken `OWNER_IDS` can never expose
 * `eval`, `shutdown` or `reload`.
 */
export function isOwner(memberId: string, owners: readonly string[] | null | undefined): boolean {
    return Array.isArray(owners) && owners.length > 0 && owners.includes(memberId);
}

/**
 * Evaluate all pre-execution checks shared by MessageCreate and
 * InteractionCreate. Replies stay in the adapters so prefix output keeps its
 * auto-delete behaviour and slash output keeps its ephemeral flag.
 */
export async function evaluateCommand(input: GateInput): Promise<GateResult> {
    const { client, command, guildId, member, me, channel, settings, args } = input;
    const language = input.language ?? client.config.defaultLanguage;
    const t = (key: string, variables: Record<string, string | number> = {}): string =>
        translate(key, language, variables);
    const manageGuild = member.hasPermission(PermissionFlagsBits.ManageGuild);

    if (command.player?.voice) {
        const preferred = await client.preferredBotStatus(guildId);
        if (!preferred.allowed) {
            return deny(
                t('errors:gate.preferredBot', {
                    name: preferred.name ?? 'the preferred bot',
                })
            );
        }
    }

    if (settings.locked === 'true' && !manageGuild) {
        return deny(t('errors:gate.locked'));
    }

    const permitted = await client.db.isCommandAllowed(guildId, command.name, member.id, [
        ...member.roleIds,
    ]);
    if (!permitted) return deny(t('errors:gate.notAllowed'));

    if (settings.allowthreads === 'false' && channel.isThread()) {
        return deny(t('errors:gate.threads'));
    }

    if (
        (settings.disabledcommands ?? '')
            .split(',')
            .map(name => name.trim().toLowerCase())
            .filter(Boolean)
            .includes(command.name)
    ) {
        return deny(t('errors:gate.disabled', { command: command.name }));
    }

    if (settings.commandchannel && settings.commandchannel !== channel.id) {
        return deny(t('errors:gate.commandChannel', { channel: settings.commandchannel }));
    }

    if (settings.voicechannel && member.voiceChannel?.id !== settings.voicechannel) {
        return deny(t('errors:gate.voiceChannel', { channel: settings.voicechannel }));
    }

    // No reply is possible in a channel the bot cannot see.
    if (!input.canViewChannel) return { ok: false, silent: true };

    if (!me.hasPermission(PermissionFlagsBits.SendMessages)) {
        return {
            ok: false,
            dm: true,
            response: {
                content: t('errors:gate.noSendMessages', {
                    guild: input.guildName,
                    channel: channel.id,
                }),
            },
        };
    }

    if (!me.hasPermission(PermissionFlagsBits.EmbedLinks)) {
        return deny(t('errors:gate.noEmbedLinks'));
    }

    for (const permission of command.permissions.client) {
        if (!me.hasPermission(permission)) {
            return deny(t('errors:gate.clientPermissions'));
        }
    }

    for (const permission of command.permissions.user) {
        if (!member.hasPermission(permission)) {
            return deny(t('errors:gate.userPermissions'));
        }
    }

    if (command.permissions.dev && !isOwner(member.id, client.config.owners)) {
        return { ok: false, silent: true };
    }

    if (command.player) {
        if (command.player.voice) {
            if (!member.voiceChannel) {
                return deny(t('errors:gate.voiceRequired', { command: command.name }));
            }
            if (!me.hasPermission(PermissionFlagsBits.Connect)) {
                return deny(t('errors:gate.noConnect', { command: command.name }));
            }
            if (!me.hasPermission(PermissionFlagsBits.Speak)) {
                return deny(t('errors:gate.noSpeak', { command: command.name }));
            }
            if (
                member.voiceChannel.type === ChannelType.GuildStageVoice &&
                !me.hasPermission(PermissionFlagsBits.RequestToSpeak)
            ) {
                return deny(t('errors:gate.noRequestToSpeak', { command: command.name }));
            }
            if (me.voiceChannel && me.voiceChannel.id !== member.voiceChannel.id) {
                return deny(
                    t('errors:gate.wrongVoice', {
                        channel: me.voiceChannel.id,
                        command: command.name,
                    })
                );
            }
        }

        if (command.player.active) {
            const player = client.queue.get(guildId);
            if (!player?.current) return deny(t('errors:gate.nothingPlaying'));
        }

        if (command.player.dj) {
            const dj = await client.db.getDj(guildId);
            if (dj && dj.mode) {
                const djRole = await client.db.getRoles(guildId);
                // `getRoles` returns an array; an empty array is truthy and
                // used to fall through to the misleading role-missing reply.
                if (!djRole.length) return deny(t('errors:gate.djRoleMissing'));
                const hasDjRole = djRole.some(role => member.roleIds.includes(role.roleId));
                if (!hasDjRole && !manageGuild) {
                    return deny(t('errors:gate.djRoleRequired'));
                }
            }
        }
    }

    // Discord enforces required slash options itself; only prefix needs this.
    if (input.isPrefix && command.args && !args.length) {
        const embed = client
            .embed()
            .setColor(client.color.red)
            .setTitle(t('errors:gate.missingTitle'))
            .setDescription(
                t('errors:gate.missingDescription', {
                    command: command.name,
                    examples: command.description.examples
                        ? command.description.examples.join('\n')
                        : 'None',
                })
            )
            .setFooter({ text: t('errors:gate.missingFooter') });
        return { ok: false, response: { embeds: [embed] } };
    }

    let timestamps = client.cooldown.get(input.commandKey);
    if (!timestamps) {
        timestamps = new Collection<string, number>();
        client.cooldown.set(input.commandKey, timestamps);
    }
    const now = Date.now();
    const cooldownAmount = Math.floor(command.cooldown ?? 3) * 1000;
    if (!timestamps.has(member.id)) {
        timestamps.set(member.id, now);
        setTimeout(() => timestamps?.delete(member.id), cooldownAmount);
    } else {
        const expirationTime = (timestamps.get(member.id) ?? now) + cooldownAmount;
        const timeLeft = (expirationTime - now) / 1000;
        if (now < expirationTime && timeLeft > 0.9) {
            return deny(
                t('errors:gate.cooldown', {
                    seconds: timeLeft.toFixed(1),
                    command: input.commandKey,
                })
            );
        }
        timestamps.set(member.id, now);
        setTimeout(() => timestamps?.delete(member.id), cooldownAmount);
    }

    if (args.some(arg => arg.includes('@everyone') || arg.includes('@here'))) {
        return deny(t('errors:gate.everyone'));
    }

    return { ok: true };
}
