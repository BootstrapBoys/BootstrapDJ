import { ApplicationCommandOptionType, TextChannel } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { updateSetup } from '../../utils/SetupSystem.js';
import { hasDjAccess } from '../../utils/VoiceAccess.js';
import { setServerMute } from '../../utils/VoiceMute.js';

export default class Listen extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'listen',
            description: {
                content: 'Control voice commands (Earl the Ear) and your listening opt-out',
                examples: ['listen enable', 'listen disable', 'listen status', 'listen optout'],
                usage: 'listen <enable|disable|status|optout|optin>',
            },
            category: 'config',
            aliases: ['ear'],
            cooldown: 3,
            args: true,
            player: {
                voice: false,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            // One top-level command with an action option instead of five
            // subcommands, so the slash list stays compact.
            options: [
                {
                    name: 'action',
                    description: 'What to do',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'Enable listening', value: 'enable' },
                        { name: 'Disable listening', value: 'disable' },
                        { name: 'Status', value: 'status' },
                        { name: 'Opt out of voice processing', value: 'optout' },
                        { name: 'Opt back in', value: 'optin' },
                    ],
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const embed = client.embed().setColor(client.color.main);
        const sub = ctx.isInteraction
            ? (ctx.interaction?.options.getString('action') ?? '')
            : (args[0] ?? '');
        const authorId = ctx.author?.id;
        if (!authorId) return;
        const member = await guild.members.fetch(authorId).catch(() => null);
        if (!member) return;

        const listener = await callListener(client, '/status');
        const state = await client.db.getVoiceListen(guild.id);

        if (sub === 'enable') {
            if (!(await hasDjAccess(client, guild.id, member))) {
                return await ctx.sendMessage({ embeds: [embed.setColor(client.color.red).setDescription('You need the DJ role to enable voice commands.')] });
            }
            const voice = ctx.voiceChannel;
            if (!voice) {
                return await ctx.sendMessage({ embeds: [embed.setColor(client.color.red).setDescription('Join a voice channel first.')] });
            }
            const setup = await client.db.getSetup(guild.id);
            const textId = setup?.textId ?? (ctx.channel instanceof TextChannel ? ctx.channel.id : null);
            if (!textId) {
                return await ctx.sendMessage({ embeds: [embed.setColor(client.color.red).setDescription('I need a text channel for replies — run `/setup` first.')] });
            }
            const result = await callListener(client, '/listen/start', {
                guildId: guild.id,
                voiceChannelId: voice.id,
                textChannelId: textId,
            });
            if (!result.ok) {
                return await ctx.sendMessage({ embeds: [embed.setColor(client.color.red).setDescription(`Earl could not start listening: ${result.error ?? 'unknown error'}`)] });
            }
            await client.db.setVoiceListen(guild.id, {
                enabled: true,
                voiceChannelId: voice.id,
                textChannelId: textId,
                updatedBy: authorId,
            });
            await updateSetup(client, guild).catch(() => {});
            const optedOut = await client.db.listVoiceOptOuts(guild.id);
            await pushOptOuts(client, optedOut.map(entry => entry.userId));
            for (const entry of optedOut) {
                if (guild.voiceStates.cache.get(entry.userId)?.channelId) {
                    const muted = await setServerMute(client, guild.id, entry.userId, true);
                    if (muted.ok) await client.db.setVoiceOptOutMuted(guild.id, entry.userId, true);
                }
            }
            return await ctx.sendMessage({ embeds: [embed.setDescription(`Listening for commands in **${voice.name}**. Say “Hey Bootstrap …”.`)] });
        }

        if (sub === 'disable') {
            if (!(await hasDjAccess(client, guild.id, member))) {
                return await ctx.sendMessage({ embeds: [embed.setColor(client.color.red).setDescription('You need the DJ role to disable voice commands.')] });
            }
            const stopped = await callListener(client, '/listen/stop');
            if (!stopped.ok) {
                return await ctx.sendMessage({
                    embeds: [embed.setColor(client.color.red).setDescription(`Earl did not stop: ${stopped.error ?? 'listener unreachable'}. Listening is still on.`)],
                });
            }
            const optedOut = await client.db.listVoiceOptOuts(guild.id);
            for (const entry of optedOut) {
                if (entry.mutedByBot) {
                    await setServerMute(client, guild.id, entry.userId, false);
                    await client.db.setVoiceOptOutMuted(guild.id, entry.userId, false);
                }
            }
            await client.db.setVoiceListen(guild.id, { enabled: false, updatedBy: authorId });
            await pushOptOuts(client, []);
            await updateSetup(client, guild).catch(() => {});
            return await ctx.sendMessage({ embeds: [embed.setDescription('Voice listening is off. Earl is sleeping one off.')] });
        }

        if (sub === 'status') {
            const optOuts = await client.db.listVoiceOptOuts(guild.id);
            const lines = [
                `**Listening:** ${state?.enabled ? 'on' : 'off'}`,
                state?.voiceChannelId ? `**Voice channel:** <#${state.voiceChannelId}>` : null,
                state?.textChannelId ? `**Replies in:** <#${state.textChannelId}>` : null,
                `**Listener:** ${listener.active === true ? 'connected' : 'not connected'}`,
                `**Opted out:** ${optOuts.length ? optOuts.map(entry => `<@${entry.userId}>`).join(', ') : 'nobody'}`,
            ].filter(Boolean);
            return await ctx.sendMessage({ embeds: [embed.setDescription(lines.join('\n'))] });
        }

        if (sub === 'optout') {
            await client.db.addVoiceOptOut(guild.id, authorId);
            let muted = false;
            let failure = '';
            const result = await setServerMute(client, guild.id, authorId, true);
            if (result.ok) {
                muted = true;
                await client.db.setVoiceOptOutMuted(guild.id, authorId, true);
            } else {
                failure = ` (mute failed: ${result.error})`;
            }
            await pushOptOuts(client, (await client.db.listVoiceOptOuts(guild.id)).map(entry => entry.userId));
            return await ctx.sendMessage({
                embeds: [embed.setDescription(`You are opted out — Earl discards your audio before transcription${muted ? ' and server-muted you' : ''}${failure}.`)],
            });
        }

        if (sub === 'optin') {
            const entry = (await client.db.listVoiceOptOuts(guild.id)).find(row => row.userId === authorId);
            await client.db.removeVoiceOptOut(guild.id, authorId);
            if (entry?.mutedByBot) await setServerMute(client, guild.id, authorId, false);
            await pushOptOuts(client, (await client.db.listVoiceOptOuts(guild.id)).map(row => row.userId));
            return await ctx.sendMessage({ embeds: [embed.setDescription('You are opted in again.')] });
        }

        return await ctx.sendMessage({
            embeds: [embed.setDescription('Usage: `/listen enable|disable|status|optout|optin`')],
        });
    }
}

async function pushOptOuts(client: BootstrapClient, userIds: string[]): Promise<void> {
    if (!client.config.earlBridgeSecret) return;
    try {
        await fetch(`${client.config.earlControlUrl}/listen/optouts`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${client.config.earlBridgeSecret}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ userIds }),
            signal: AbortSignal.timeout(5_000),
        });
    } catch {
        // The listener restarts independently; the next enable pushes again.
    }
}

async function callListener(
    client: BootstrapClient,
    path: string,
    body?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
    if (!client.config.earlBridgeSecret) return { ok: false, error: 'EARL_BRIDGE_SECRET is not set' };
    try {
        // /listen/stop takes no fields but is still a POST; sending GET made the
        // API return 404, so disable flipped the DB while Earl kept capturing.
        const control = path.startsWith('/listen');
        const response = await fetch(`${client.config.earlControlUrl}${path}`, {
            method: control ? 'POST' : 'GET',
            headers: {
                authorization: `Bearer ${client.config.earlBridgeSecret}`,
                ...(control ? { 'content-type': 'application/json' } : {}),
            },
            body: control ? JSON.stringify(body ?? {}) : undefined,
            signal: AbortSignal.timeout(5_000),
        });
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok)
            return {
                ok: false,
                error: typeof data.error === 'string' ? data.error : `HTTP ${response.status}`,
                ...data,
            };
        return { ok: true, ...data };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
