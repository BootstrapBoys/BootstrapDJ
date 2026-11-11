import { ChannelType } from 'discord.js';

import type { BootstrapClient, Dispatcher } from '../core/index.js';
import { dashboardVoiceChannelIdFor } from '../lib/DashboardVoice.js';
import { getDashboardListenerCount, setDashboardListenerCount } from './listeners.js';

const timers = new Map<string, NodeJS.Timeout>();
const DEFAULT_EMPTY_SECONDS = 5;

type DashboardVoiceChannel = {
    id: string;
    members: Map<string, { user: { bot: boolean } }>;
};

function dashboardChannel(
    client: BootstrapClient,
    guildId: string,
    player: Dispatcher | null | undefined = client.queue.get(guildId)
): DashboardVoiceChannel | null {
    const configured = dashboardVoiceChannelIdFor(client, player);
    if (!configured) return null;
    const guild = client.guilds.cache.get(guildId);
    const channelId = guild?.members.me?.voice.channelId;
    if (!channelId || channelId !== configured) return null;
    const channel = guild.channels.cache.get(channelId);
    if (
        !channel ||
        (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
    ) {
        return null;
    }
    return channel as unknown as DashboardVoiceChannel;
}

function hasDiscordListener(channel: DashboardVoiceChannel): boolean {
    return [...channel.members.values()].some(member => !member.user.bot);
}

function clearAndLeave(client: BootstrapClient, guildId: string, player: Dispatcher): void {
    if (client.queue.get(guildId) !== player) return;
    const channel = dashboardChannel(client, guildId, player);
    if (!channel || hasDiscordListener(channel) || getDashboardListenerCount(guildId) > 0) return;

    client.logger.info(
        `[dashboard] no listeners in Discord or the dashboard; clearing queue and leaving ${guildId}`
    );
    player.clearQueue();
    player.autoplay = false;
    player.destroy();
}

function schedule(
    client: BootstrapClient,
    guildId: string,
    player: Dispatcher,
    channel: DashboardVoiceChannel,
    delayMs: number
): void {
    if (hasDiscordListener(channel) || getDashboardListenerCount(guildId) > 0) return;

    if (!player.current && !player.queue.length && !player.autoplay) {
        clearAndLeave(client, guildId, player);
        return;
    }
    if (delayMs <= 0) return;

    const timer = setTimeout(() => {
        timers.delete(guildId);
        if (client.queue.get(guildId) !== player) return;
        clearAndLeave(client, guildId, player);
    }, delayMs);
    timer.unref();
    timers.set(guildId, timer);
}

/** Stop any pending dashboard-idle teardown. */
export function cancelDashboardCleanup(guildId: string): void {
    const timer = timers.get(guildId);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(guildId);
}

/**
 * Apply the sidecar's absolute browser-listener count and immediately
 * reconcile the dashboard channel's idle timer.
 */
export function applyDashboardListenerCount(
    client: BootstrapClient,
    guildId: string,
    count: number
): number {
    const normalized = setDashboardListenerCount(guildId, count);
    if (normalized > 0) {
        cancelDashboardCleanup(guildId);
    } else {
        void scheduleDashboardCleanupFromSettings(client, guildId);
    }
    return normalized;
}

/**
 * Schedule a dashboard-channel teardown when there is no Discord listener and
 * no active browser audio stream. The player is re-checked when the timer
 * fires, so a reconnected listener or a replacement player wins.
 */
export function scheduleDashboardCleanup(
    client: BootstrapClient,
    guildId: string,
    delayMs: number
): void {
    cancelDashboardCleanup(guildId);
    const player = client.queue.get(guildId);
    if (!player) return;
    const channel = dashboardChannel(client, guildId, player);
    if (!channel) return;
    schedule(client, guildId, player, channel, delayMs);
}

/** Use the guild's existing `timeoutlisteners` setting as the grace period. */
export async function scheduleDashboardCleanupFromSettings(
    client: BootstrapClient,
    guildId: string
): Promise<void> {
    let seconds = DEFAULT_EMPTY_SECONDS;
    try {
        const settings = await client.db.getGuildSettings(guildId);
        const configured = Number(settings.timeoutlisteners ?? DEFAULT_EMPTY_SECONDS);
        if (Number.isFinite(configured) && configured >= 0) seconds = configured;
    } catch {
        // Keep the conservative fallback when settings are unavailable.
    }
    scheduleDashboardCleanup(client, guildId, seconds * 1000);
}
