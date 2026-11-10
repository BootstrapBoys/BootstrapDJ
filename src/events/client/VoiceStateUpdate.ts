import { ChannelType, PermissionFlagsBits, VoiceState } from 'discord.js';

import { BootstrapClient, Dispatcher, Event } from '../../core/index.js';

export default class VoiceStateUpdate extends Event {
    private readonly emptyTimers = new Map<string, NodeJS.Timeout>();

    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'voiceStateUpdate' });
    }

    private cancel(guildId: string): void {
        const timer = this.emptyTimers.get(guildId);
        if (!timer) return;
        clearTimeout(timer);
        this.emptyTimers.delete(guildId);
    }

    /** Browser playback may stay connected while it still has audio. */
    private isDashboardChannel(channelId: string | null | undefined): boolean {
        const configured = (this.client.config?.dashboardVoiceChannelId ?? '').trim();
        return Boolean(configured && channelId === configured);
    }

    /**
     * Destroy only if this is still the same player and the channel is still
     * empty when the timer fires. A replaced player must survive an old timer.
     */
    private scheduleTeardown(guildId: string, player: Dispatcher, delayMs: number): void {
        this.cancel(guildId);
        const timer = setTimeout(() => {
            this.emptyTimers.delete(guildId);
            if (this.client.queue.get(guildId) !== player) return;

            const guild = this.client.guilds.cache.get(guildId);
            const channelId = guild?.members.me?.voice.channelId;
            if (!guild || !channelId) return;

            const channel = guild.channels.cache.get(channelId);
            if (
                !channel ||
                (channel.type !== ChannelType.GuildVoice &&
                    channel.type !== ChannelType.GuildStageVoice)
            ) {
                return;
            }
            if (this.isDashboardChannel(channel.id)) return;
            if (channel.members.some(member => !member.user.bot)) return;
            player.destroy();
        }, delayMs);
        timer.unref();
        this.emptyTimers.set(guildId, timer);
    }

    private async resumeWhenListened(
        state: VoiceState,
        meChannelId: string | null,
        player: Dispatcher
    ): Promise<void> {
        if (!state.channelId || state.channelId !== meChannelId) return;
        if (!state.member || state.member.user.bot) return;
        this.cancel(state.guild.id);
        const stay = await this.client.db.get_247(state.guild.id).catch(() => null);
        if (!stay) return;
        player.pauseWhenEmpty = false;
        player.resume247();
    }

    public async run(_oldState: VoiceState, state: VoiceState): Promise<void> {
        const guildId = state.guild.id;
        const me = state.guild.members.me;
        const botId = this.client.user?.id;
        if (!botId || !me || this.client.shuttingDown) return;

        const player = this.client.queue.get(guildId);
        if (!player) return;

        const settings = await this.client.db.getGuildSettings(guildId);
        const configuredWait = Number(settings.timeoutlisteners ?? 5);
        const waitSeconds =
            Number.isFinite(configuredWait) && configuredWait >= 0 ? configuredWait : 5;
        const botState = state.id === botId;
        const botChannel = me.voice.channel;

        if (!botState) await this.resumeWhenListened(state, me.voice.channelId, player);

        if (!me.voice.channelId) {
            this.cancel(guildId);
            player.destroy();
            return;
        }

        if (botState) {
            if (state.channelId && state.channelId !== player.voiceId) {
                player.voiceId = state.channelId;
                void player.persist();
            }
            const stage = state.channel;
            if (
                state.channelId &&
                stage?.type === ChannelType.GuildStageVoice &&
                me.voice.suppress &&
                (me.permissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]) ||
                    stage.permissionsFor(me)?.has(PermissionFlagsBits.MuteMembers))
            ) {
                await me.voice.setSuppressed(false).catch(() => {});
            }
            return;
        }

        if (!botChannel) return;
        if (this.isDashboardChannel(botChannel.id)) {
            this.cancel(guildId);
            if (!player.current && !player.queue?.length && !player.autoplay) {
                player.destroy();
            }
            return;
        }
        if (botChannel.members.some(member => !member.user.bot)) {
            this.cancel(guildId);
            return;
        }

        const stay = await this.client.db.get_247(guildId).catch(() => null);
        if (stay) {
            this.cancel(guildId);
            player.pauseWhenEmpty = true;
            return;
        }
        if (waitSeconds <= 0) {
            this.cancel(guildId);
            return;
        }
        this.scheduleTeardown(guildId, player, waitSeconds * 1000);
    }
}
