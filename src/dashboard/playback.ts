import {
    ChannelType,
    type Guild,
    type GuildTextBasedChannel,
    PermissionFlagsBits,
} from 'discord.js';
import { LoadType, type Track } from 'shoukaku';

import type { BootstrapClient, Dispatcher, Song } from '../core/index.js';
import { resolveDashboardVoiceChannelId } from '../lib/DashboardVoice.js';
import { checkTrack, getPlayLimits } from '../lib/PlayLimits.js';
import { scheduleDashboardCleanupFromSettings } from './cleanup.js';
import type { QueueAddResult } from './host.js';

const DEFAULT_TEXT_FALLBACK = 'No text channel is available for playback replies.';

type EnsureResult = { ok: true; player: Dispatcher } | { ok: false; status: number; error: string };

function textChannelFor(guild: Guild): GuildTextBasedChannel | null {
    const me = guild.members.me;
    if (!me) return null;
    const canPost = (channel: GuildTextBasedChannel): boolean =>
        channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages) ?? false;

    if (guild.systemChannel && canPost(guild.systemChannel)) return guild.systemChannel;
    for (const channel of guild.channels.cache.values()) {
        if (!channel.isTextBased() || channel.isThread()) continue;
        if (canPost(channel)) return channel;
    }
    return null;
}

/**
 * Resolve the configured browser-only voice channel and create a player when
 * the guild has none. This is the one path that may join voice without a human
 * member; normal commands still use the caller's voice state.
 */
export async function ensureDashboardPlayer(
    client: BootstrapClient,
    guildId: string,
    configuredChannelId?: string
): Promise<EnsureResult> {
    const existing = client.queue.get(guildId);
    if (existing && !existing.isStale) return { ok: true, player: existing };

    const channelId = (
        configuredChannelId ?? (await resolveDashboardVoiceChannelId(client, guildId))
    ).trim();
    if (!channelId) {
        return {
            ok: false,
            status: 409,
            error: 'The bot is not connected. Set the dashboard voice channel setting or DASHBOARD_VOICE_CHANNEL_ID to enable browser-only playback.',
        };
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, status: 404, error: 'Guild not found.' };

    const channel =
        guild.channels.cache.get(channelId) ??
        (await guild.channels.fetch(channelId).catch(() => null));
    if (
        !channel ||
        (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
    ) {
        return {
            ok: false,
            status: 409,
            error: 'The configured dashboard voice channel must point to a voice channel in this server.',
        };
    }

    const me = guild.members.me;
    if (!me) return { ok: false, status: 503, error: 'The bot member is not available yet.' };
    const permissions = channel.permissionsFor(me);
    if (
        !permissions?.has(PermissionFlagsBits.Connect) ||
        !permissions.has(PermissionFlagsBits.Speak)
    ) {
        return {
            ok: false,
            status: 403,
            error: 'The bot needs Connect and Speak permissions in the configured dashboard voice channel.',
        };
    }

    const text = textChannelFor(guild);
    if (!text) return { ok: false, status: 409, error: DEFAULT_TEXT_FALLBACK };

    try {
        const player = await client.queue.create(guild, channel, text);
        player.dashboardMode = true;
        player.dashboardVoiceChannelId = channelId;
        return { ok: true, player };
    } catch (error) {
        return {
            ok: false,
            status: 503,
            error:
                error instanceof Error
                    ? error.message
                    : 'The bot could not join the configured voice channel.',
        };
    }
}

export type DashboardPlayResult = QueueAddResult;

/** Add one search result, track, or playlist from the dashboard to the queue. */
export async function addDashboardSong(
    client: BootstrapClient,
    guildId: string,
    userId: string,
    rawQuery: string
): Promise<DashboardPlayResult> {
    const query = rawQuery.trim();
    if (!query) return { ok: false, status: 400, error: 'A song name or URL is required.' };

    const ensured = await ensureDashboardPlayer(client, guildId);
    if (!ensured.ok) {
        return { ok: false, status: ensured.status, error: ensured.error };
    }
    const player = ensured.player;

    const requester = await client.users.fetch(userId).catch(() => client.user);
    if (!requester) return { ok: false, status: 500, error: 'Could not resolve the requester.' };

    const result = await client.queue.search(query, client.config.searchEngine);
    if (!result) return { ok: false, status: 503, error: 'Lavalink is not available right now.' };
    if (result.loadType === LoadType.ERROR) {
        const detail = (result.data as { cause?: string; message?: string }).cause ?? 'load error';
        client.logger.warn(`[dashboard] play failed for ${query}: ${detail}`);
        return { ok: false, status: 502, error: 'Lavalink could not load that track.' };
    }
    if (result.loadType === LoadType.EMPTY)
        return { ok: false, status: 404, error: 'No results found.' };

    const limits = await getPlayLimits(client, guildId);
    const accepted: Song[] = [];
    const candidates: Track[] =
        result.loadType === LoadType.PLAYLIST
            ? result.data.tracks.slice(0, client.config.maxPlaylistSize || undefined)
            : result.loadType === LoadType.TRACK
              ? [result.data]
              : result.data.slice(0, 1);
    if (!candidates.length) return { ok: false, status: 404, error: 'No results found.' };

    for (const track of candidates) {
        const song = player.buildTrack(track, requester);
        if (checkTrack(player, song, requester.id, limits, accepted)) continue;
        player.enqueue(song, false, false);
        accepted.push(song);
    }
    if (!accepted.length) {
        return {
            ok: false,
            status: 409,
            error: 'That request was rejected by this server’s queue limits.',
        };
    }

    if (result.loadType === LoadType.PLAYLIST) player.seedPlaylist(accepted);
    await player.isPlaying();
    void scheduleDashboardCleanupFromSettings(client, guildId);
    const first = accepted[0].info;
    return {
        ok: true,
        added: accepted.length,
        skipped: candidates.length - accepted.length,
        title: first.title,
    };
}
