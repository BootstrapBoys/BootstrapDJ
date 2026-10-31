import { ApplicationCommandOptionType, TextChannel } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { updateSetup } from '../../utils/SetupSystem.js';
import { hasDjAccess } from '../../utils/VoiceAccess.js';

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
            options: [
                { name: 'enable', description: 'Start listening for voice commands', type: ApplicationCommandOptionType.Subcommand },
                { name: 'disable', description: 'Stop listening for voice commands', type: ApplicationCommandOptionType.Subcommand },
                { name: 'status', description: 'Show listening state and opt-outs', type: ApplicationCommandOptionType.Subcommand },
                { name: 'optout', description: 'Do not let Earl process your voice', type: ApplicationCommandOptionType.Subcommand },
                { name: 'optin', description: 'Allow Earl to process your voice again', type: ApplicationCommandOptionType.Subcommand },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const embed = client.embed().setColor(client.color.main);
        const sub = ctx.isInteraction
            ? (ctx.interaction?.options.data[0]?.name ?? '')
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
            return await ctx.sendMessage({ embeds: [embed.setDescription(`Listening for commands in **${voice.name}**. Say “Hey Mister DJ …”.`)] });
        }

        if (sub === 'disable') {
            if (!(await hasDjAccess(client, guild.id, member))) {
                return await ctx.sendMessage({ embeds: [embed.setColor(client.color.red).setDescription('You need the DJ role to disable voice commands.')] });
            }
            await callListener(client, '/listen/stop');
            await client.db.setVoiceListen(guild.id, { enabled: false, updatedBy: authorId });
            await updateSetup(client, guild).catch(() => {});
            return await ctx.sendMessage({ embeds: [embed.setDescription('Voice listening is off. Earl is sleeping one off.')] });
        }

        if (sub === 'status') {
            const optOuts = await client.db.listVoiceOptOuts(guild.id);
            const lines = [
                `**Listening:** ${state?.enabled ? 'on' : 'off'}`,
                state?.voiceChannelId ? `**Voice channel:** <#${state.voiceChannelId}>` : null,
                state?.textChannelId ? `**Replies in:** <#${state.textChannelId}>` : null,
                `**Listener:** ${typeof listener !== 'object' || listener.active ? 'connected' : 'not connected'}`,
                `**Opted out:** ${optOuts.length ? optOuts.map(entry => `<@${entry.userId}>`).join(', ') : 'nobody'}`,
            ].filter(Boolean);
            return await ctx.sendMessage({ embeds: [embed.setDescription(lines.join('\n'))] });
        }

        if (sub === 'optout') {
            await client.db.addVoiceOptOut(guild.id, authorId);
            return await ctx.sendMessage({ embeds: [embed.setDescription('You are opted out — Earl will discard your audio before transcription.')] });
        }

        if (sub === 'optin') {
            await client.db.removeVoiceOptOut(guild.id, authorId);
            return await ctx.sendMessage({ embeds: [embed.setDescription('You are opted in again.')] });
        }

        return await ctx.sendMessage({
            embeds: [embed.setDescription('Usage: `/listen enable|disable|status|optout|optin`')],
        });
    }
}

async function callListener(
    client: BootstrapClient,
    path: string,
    body?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
    if (!client.config.earlBridgeSecret) return { ok: false, error: 'EARL_BRIDGE_SECRET is not set' };
    try {
        const response = await fetch(`${client.config.earlControlUrl}${path}`, {
            method: body ? 'POST' : 'GET',
            headers: {
                authorization: `Bearer ${client.config.earlBridgeSecret}`,
                ...(body ? { 'content-type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
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
