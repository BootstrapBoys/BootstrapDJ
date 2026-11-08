import type BootstrapClient from '../core/BootstrapClient.js';
import type Command from '../core/Command.js';
import { ChannelType, Collection, EmbedBuilder, PermissionFlagsBits, type PermissionsString } from 'discord.js';

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
 * Evaluate all pre-execution checks shared by MessageCreate and
 * InteractionCreate. Replies stay in the adapters so prefix output keeps its
 * auto-delete behaviour and slash output keeps its ephemeral flag.
 */
export async function evaluateCommand(input: GateInput): Promise<GateResult> {
    const { client, command, guildId, member, me, channel, settings, args } = input;
    const manageGuild = member.hasPermission(PermissionFlagsBits.ManageGuild);

    if (command.player?.voice) {
        const preferred = await client.preferredBotStatus(guildId);
        if (!preferred.allowed) {
            return deny(
                `Voice commands are routed to **${preferred.name ?? 'the preferred bot'}** for this server. Use that bot.`
            );
        }
    }

    if (settings.locked === 'true' && !manageGuild) {
        return deny('This session is locked. A server manager must unlock it.');
    }

    const permitted = await client.db.isCommandAllowed(guildId, command.name, member.id, [
        ...member.roleIds,
    ]);
    if (!permitted) return deny('You are not allowed to use this command.');

    if (settings.allowthreads === 'false' && channel.isThread()) {
        return deny('Commands are disabled in threads for this server.');
    }

    if (
        (settings.disabledcommands ?? '')
            .split(',')
            .map(name => name.trim().toLowerCase())
            .filter(Boolean)
            .includes(command.name)
    ) {
        return deny(`**${command.name}** is disabled in this server.`);
    }

    if (settings.commandchannel && settings.commandchannel !== channel.id) {
        return deny(`Commands are restricted to <#${settings.commandchannel}>.`);
    }

    if (settings.voicechannel && member.voiceChannel?.id !== settings.voicechannel) {
        return deny(`You must be in <#${settings.voicechannel}> to use commands.`);
    }

    // No reply is possible in a channel the bot cannot see.
    if (!input.canViewChannel) return { ok: false, silent: true };

    if (!me.hasPermission(PermissionFlagsBits.SendMessages)) {
        return {
            ok: false,
            dm: true,
            response: {
                content: `I don't have **\`SendMessage\`** permission in \`${input.guildName}\`\nchannel: <#${channel.id}>`,
            },
        };
    }

    if (!me.hasPermission(PermissionFlagsBits.EmbedLinks)) {
        return deny('I don\'t have **`EmbedLinks`** permission.');
    }

    for (const permission of command.permissions.client) {
        if (!me.hasPermission(permission)) {
            return deny('I don\'t have enough permissions to execute this command.');
        }
    }

    for (const permission of command.permissions.user) {
        if (!member.hasPermission(permission)) {
            return deny('You don\'t have enough permissions to use this command.');
        }
    }

    if (command.permissions.dev && client.config.owners) {
        if (!client.config.owners.includes(member.id)) return { ok: false, silent: true };
    }

    if (command.player) {
        if (command.player.voice) {
            if (!member.voiceChannel) {
                return deny(
                    `You must be connected to a voice channel to use this \`${command.name}\` command.`
                );
            }
            if (!me.hasPermission(PermissionFlagsBits.Connect)) {
                return deny(
                    `I don't have \`CONNECT\` permissions to execute this \`${command.name}\` command.`
                );
            }
            if (!me.hasPermission(PermissionFlagsBits.Speak)) {
                return deny(
                    `I don't have \`SPEAK\` permissions to execute this \`${command.name}\` command.`
                );
            }
            if (
                member.voiceChannel.type === ChannelType.GuildStageVoice &&
                !me.hasPermission(PermissionFlagsBits.RequestToSpeak)
            ) {
                return deny(
                    `I don't have \`REQUEST TO SPEAK\` permission to execute this \`${command.name}\` command.`
                );
            }
            if (me.voiceChannel && me.voiceChannel.id !== member.voiceChannel.id) {
                return deny(
                    `You are not connected to <#${me.voiceChannel.id}> to use this \`${command.name}\` command.`
                );
            }
        }

        if (command.player.active) {
            const player = client.queue.get(guildId);
            if (!player?.current) return deny('Nothing is playing right now.');
        }

        if (command.player.dj) {
            const dj = await client.db.getDj(guildId);
            if (dj && dj.mode) {
                const djRole = await client.db.getRoles(guildId);
                if (!djRole) return deny('DJ role is not set.');
                const hasDjRole = djRole.some(role => member.roleIds.includes(role.roleId));
                if (!hasDjRole && !manageGuild) {
                    return deny('You need to have the DJ role to use this command.');
                }
            }
        }
    }

    // Discord enforces required slash options itself; only prefix needs this.
    if (input.isPrefix && command.args && !args.length) {
        const embed = client
            .embed()
            .setColor(client.color.red)
            .setTitle('Missing Arguments')
            .setDescription(
                `Please provide the required arguments for the \`${command.name}\` command.\n\nExamples:\n${
                    command.description.examples ? command.description.examples.join('\n') : 'None'
                }`
            )
            .setFooter({ text: 'Syntax: [] = optional, <> = required' });
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
                `Please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${input.commandKey}\` command.`
            );
        }
        timestamps.set(member.id, now);
        setTimeout(() => timestamps?.delete(member.id), cooldownAmount);
    }

    if (args.some(arg => arg.includes('@everyone') || arg.includes('@here'))) {
        return deny('You can\'t mention everyone or here.');
    }

    return { ok: true };
}
