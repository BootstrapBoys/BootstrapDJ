import { ChannelType, PermissionFlagsBits, VoiceState } from 'discord.js';

import { BootstrapClient, Event } from '../../core/index.js';

export default class VoiceStateUpdate extends Event {
    /** One pending empty-channel teardown per guild. A second leave/rejoin must
     * replace the timer instead of stacking another destroy call. */
    private readonly emptyTimers = new Map<string, NodeJS.Timeout>();

    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'voiceStateUpdate',
        });
    }

    public async run(_oldState: VoiceState, newState: VoiceState): Promise<void> {
        const guildId = newState.guild.id;
        const botId = this.client.user?.id;
        const me = newState.guild.members.me;
        if (!guildId || !botId || !me || this.client.shuttingDown) return;
        const player = this.client.queue.get(guildId);
        if (!player) return;

        const settings = await this.client.db.getGuildSettings(guildId);
        const listenerWait = Number(settings.timeoutlisteners ?? 5);
        const listenerWaitMs =
            (Number.isFinite(listenerWait) && listenerWait >= 0 ? listenerWait : 5) * 1000;
        const isBot = newState.id === botId;
        const botChannel = me.voice.channel;

        // A real listener joining the bot's channel cancels a pending teardown
        // and resumes a paused 24/7 session.
        if (
            !isBot &&
            newState.channelId &&
            newState.channelId === me.voice.channelId &&
            newState.member &&
            !newState.member.user.bot
        ) {
            this.clearEmptyTimer(guildId);
            const stay = await this.client.db.get_247(guildId).catch(() => null);
            if (stay) {
                player.pauseWhenEmpty = false;
                player.resume247();
            }
        }

        // The bot itself left voice; no channel teardown timer can help.
        if (!me.voice.channelId) {
            this.clearEmptyTimer(guildId);
            player.destroy();
            return;
        }

        if (isBot) {
            // Keep the dispatcher's voice id current when the bot is moved
            // between channels; restore/sampling/24-7 checks use it.
            if (newState.channelId && newState.channelId !== player.voiceId) {
                player.voiceId = newState.channelId;
                void player.persist();
            }
            if (
                newState.channelId &&
                newState.channel?.type === ChannelType.GuildStageVoice &&
                me.voice.suppress &&
                (me.permissions.has(['Connect', 'Speak']) ||
                    newState.channel.permissionsFor(me)?.has(PermissionFlagsBits.MuteMembers))
            ) {
                await me.voice.setSuppressed(false).catch(() => {});
            }
            return;
        }

        if (!botChannel) return;

        // A listener leaving is only relevant when nobody but bots remains.
        const humans = botChannel.members.filter(member => !member.user.bot).size;
        if (humans > 0) {
            this.clearEmptyTimer(guildId);
            return;
        }

        const stay = await this.client.db.get_247(guildId).catch(() => null);
        if (stay) {
            this.clearEmptyTimer(guildId);
            player.pauseWhenEmpty = true;
            return;
        }

        if (listenerWaitMs <= 0) {
            // timeoutlisteners=0 means "stay connected", not "destroy now".
            this.clearEmptyTimer(guildId);
            return;
        }
        this.scheduleEmptyTimeout(guildId, player, listenerWaitMs);
    }

    private clearEmptyTimer(guildId: string): void {
        const timer = this.emptyTimers.get(guildId);
        if (!timer) return;
        clearTimeout(timer);
        this.emptyTimers.delete(guildId);
    }

    private scheduleEmptyTimeout(
        guildId: string,
        player: NonNullable<ReturnType<BootstrapClient['queue']['get']>>,
        delayMs: number
    ): void {
        this.clearEmptyTimer(guildId);
        const timer = setTimeout(() => {
            this.emptyTimers.delete(guildId);
            const current = this.client.queue.get(guildId);
            // A rebuilt/restored player has its own lifecycle; never destroy it
            // from a stale timer belonging to the previous dispatcher.
            if (current !== player) return;
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
            if (channel.members.some(member => !member.user.bot)) return;
            current.destroy();
        }, delayMs);
        this.emptyTimers.set(guildId, timer);
        (timer as unknown as { unref?: () => void }).unref?.();
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
