import { ApplicationCommandOptionType, TextChannel } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { updateSetup } from '../../lib/SetupSystem.js';
import { hasDjAccess } from '../../lib/VoiceAccess.js';

type ControlResponse = { ok: boolean; error?: string } & Record<string, unknown>;

export default class Listen extends Command {
    public constructor(client: BootstrapClient) {
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
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            // One action option instead of five subcommands keeps the slash
            // surface compact.
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

    private action(ctx: Context, args: string[]): string {
        if (ctx.isInteraction && ctx.interaction) {
            return ctx.interaction.options.getString('action') ?? '';
        }
        return args[0] ?? '';
    }

    private reply(
        client: BootstrapClient,
        ctx: Context,
        text: string,
        error: boolean = false
    ): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(error ? client.color.red : client.color.main)
                    .setDescription(text),
            ],
        });
    }

    /** The listener app owns the audio pipeline; this is only its control API. */
    private async call(path: string, body?: Record<string, unknown>): Promise<ControlResponse> {
        const secret = this.client.config.earlBridgeSecret;
        if (!secret) return { ok: false, error: 'EARL_BRIDGE_SECRET is not set' };
        const control = path.startsWith('/listen');
        try {
            const response = await fetch(`${this.client.config.earlControlUrl}${path}`, {
                method: control ? 'POST' : 'GET',
                headers: {
                    authorization: `Bearer ${secret}`,
                    ...(control ? { 'content-type': 'application/json' } : {}),
                },
                body: control ? JSON.stringify(body ?? {}) : undefined,
                signal: AbortSignal.timeout(5_000),
            });
            const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
            if (!response.ok) {
                return {
                    ok: false,
                    error: typeof data.error === 'string' ? data.error : `HTTP ${response.status}`,
                    ...data,
                };
            }
            return { ok: true, ...data };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    private async pushOptOuts(userIds: string[]): Promise<void> {
        const secret = this.client.config.earlBridgeSecret;
        if (!secret) return;
        try {
            await fetch(`${this.client.config.earlControlUrl}/listen/optouts`, {
                method: 'POST',
                headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
                body: JSON.stringify({ userIds }),
                signal: AbortSignal.timeout(5_000),
            });
        } catch {
            // The listener restarts independently; the next enable pushes again.
        }
    }

    private async enable(client: BootstrapClient, ctx: Context, userId: string): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;
        if (!(await hasDjAccess(client, guild.id, member))) {
            return await this.reply(
                client,
                ctx,
                'You need the DJ role to enable voice commands.',
                true
            );
        }
        const voice = ctx.voiceChannel;
        if (!voice) return await this.reply(client, ctx, 'Join a voice channel first.', true);

        const setup = await client.db.getSetup(guild.id);
        const textId =
            setup?.textId ?? (ctx.channel instanceof TextChannel ? ctx.channel.id : null);
        if (!textId) {
            return await this.reply(
                client,
                ctx,
                'I need a text channel for replies — run `/setup` first.',
                true
            );
        }

        const started = await this.call('/listen/start', {
            guildId: guild.id,
            voiceChannelId: voice.id,
            textChannelId: textId,
        });
        if (!started.ok) {
            return await this.reply(
                client,
                ctx,
                `Earl could not start listening: ${started.error ?? 'unknown error'}`,
                true
            );
        }

        await client.db.setVoiceListen(guild.id, {
            enabled: true,
            voiceChannelId: voice.id,
            textChannelId: textId,
            updatedBy: userId,
        });
        await updateSetup(client, guild).catch(() => {});
        const optedOut = await client.db.listVoiceOptOuts(guild.id);
        await this.pushOptOuts(optedOut.map(entry => entry.userId));
        return await this.reply(
            client,
            ctx,
            `Listening for commands in **${voice.name}**. Say “Hey Bootstrap …”.`
        );
    }

    private async disable(client: BootstrapClient, ctx: Context, userId: string): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;
        if (!(await hasDjAccess(client, guild.id, member))) {
            return await this.reply(
                client,
                ctx,
                'You need the DJ role to disable voice commands.',
                true
            );
        }

        const stopped = await this.call('/listen/stop');
        if (!stopped.ok) {
            return await this.reply(
                client,
                ctx,
                `Earl did not stop: ${stopped.error ?? 'listener unreachable'}. Listening is still on.`,
                true
            );
        }
        await client.db.setVoiceListen(guild.id, { enabled: false, updatedBy: userId });
        await this.pushOptOuts([]);
        await updateSetup(client, guild).catch(() => {});
        return await this.reply(client, ctx, 'Voice listening is off. Earl is sleeping one off.');
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const action = this.action(ctx, args);

        switch (action) {
            case 'enable':
                return await this.enable(client, ctx, author.id);
            case 'disable':
                return await this.disable(client, ctx, author.id);
            default:
                break;
        }

        const listener = await this.call('/status');
        const state = await client.db.getVoiceListen(guild.id);

        if (action === 'status') {
            const optOuts = await client.db.listVoiceOptOuts(guild.id);
            const lines = [
                `**Listening:** ${state?.enabled ? 'on' : 'off'}`,
                state?.voiceChannelId ? `**Voice channel:** <#${state.voiceChannelId}>` : null,
                state?.textChannelId ? `**Replies in:** <#${state.textChannelId}>` : null,
                `**Listener:** ${listener.active === true ? 'connected' : 'not connected'}`,
                `**Opted out:** ${
                    optOuts.length > 0
                        ? optOuts.map(entry => `<@${entry.userId}>`).join(', ')
                        : 'nobody'
                }`,
            ].filter((line): line is string => Boolean(line));
            return await this.reply(client, ctx, lines.join('\n'));
        }

        if (action === 'optout' || action === 'optin') {
            if (action === 'optout') await client.db.addVoiceOptOut(guild.id, author.id);
            else await client.db.removeVoiceOptOut(guild.id, author.id);
            const optedOut = await client.db.listVoiceOptOuts(guild.id);
            await this.pushOptOuts(optedOut.map(entry => entry.userId));
            return await this.reply(
                client,
                ctx,
                action === 'optout'
                    ? 'You are opted out — Earl will not listen to you or reply while listening is active.'
                    : 'You are opted in again.'
            );
        }

        return await this.reply(client, ctx, 'Usage: `/listen enable|disable|status|optout|optin`');
    }
}
