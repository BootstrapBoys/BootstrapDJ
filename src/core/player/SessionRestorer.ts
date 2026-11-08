import { ChannelType, Message, TextChannel, User } from 'discord.js';
import { LoadType } from 'shoukaku';

import Dispatcher, { fromSaved, type SavedTrack, Song } from '../Dispatcher.js';
import type { BootstrapClient } from '../index.js';
import type { Session } from '../../generated/prisma/client.js';

/** True when at least one human is connected; bots do not count as listeners. */
export function hasListeners(
    members: Iterable<{ user?: { bot?: boolean } | null } | null>
): boolean {
    for (const member of members) {
        if (member && !member.user?.bot) return true;
    }
    return false;
}

/** Is a stored session still worth restoring? `<= 0` disables restore entirely. */
export function isRestorable(
    updatedAt: Date,
    maxAgeSeconds: number,
    now: number = Date.now()
): boolean {
    if (maxAgeSeconds <= 0) return false;
    return now - updatedAt.getTime() <= maxAgeSeconds * 1000;
}

/** `ready` fires before Lavalink nodes connect; restoring needs a node. */
export async function waitForNode(
    client: BootstrapClient,
    timeoutMs: number = 120_000
): Promise<boolean> {
    if (client.queue.hasNode) return true;

    // A slow Lavalink start used to cost the saved queue: the old 20s poll gave
    // up and restore was skipped for the rest of the process. Wait for the
    // node's ready event instead, falling back to polling and a long deadline.
    return await new Promise<boolean>((resolve: (value: boolean) => void) => {
        let settled = false;
        const finish = (available: boolean): void => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            clearInterval(poll);
            client.shoukaku.off('ready', onReady);
            resolve(available);
        };
        const onReady = (): void => finish(true);
        const poll = setInterval(() => {
            if (client.queue.hasNode) finish(true);
        }, 500);
        const deadline = setTimeout(() => finish(client.queue.hasNode), timeoutMs);
        client.shoukaku.once('ready', onReady);
    });
}

/**
 * Re-resolve a saved track so its encoded payload is fresh for this process.
 * Stored tokens can expire — LavaSrc stamps a per-search token into `encoded`.
 */
async function resolveSaved(client: BootstrapClient, saved: SavedTrack): Promise<Song | null> {
    const node = client.queue.node;
    const botUser = client.user;
    if (!node || !botUser) return null;
    const identifier =
        saved.info.uri ?? `${client.config.searchEngine}:${saved.info.title} ${saved.info.author}`;
    const res = await node.rest.resolve(identifier).catch(() => null);
    if (!res) return null;
    switch (res.loadType) {
        case LoadType.TRACK:
            return new Song(res.data, botUser, saved.autoplay);
        case LoadType.SEARCH:
            return res.data.length ? new Song(res.data[0], botUser, saved.autoplay) : null;
        case LoadType.PLAYLIST:
            return res.data.tracks.length
                ? new Song(res.data.tracks[0], botUser, saved.autoplay)
                : null;
        default:
            return null;
    }
}

/** Poll a channel until a human is present, or the window expires. */
export async function waitForListeners(
    channel: {
        members: { values(): IterableIterator<{ user?: { bot?: boolean } | null } | null> };
    },
    seconds: number,
    intervalMs: number = 1000
): Promise<boolean> {
    if (hasListeners(channel.members.values())) return true;
    if (seconds <= 0) return false;
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, intervalMs));
        if (hasListeners(channel.members.values())) return true;
    }
    return false;
}

/**
 * Rebuild players for sessions left behind by a crash or restart: rejoin the
 * voice channel, restore volume/loop/autoplay, resume the current track at its
 * saved position and re-queue the rest. Unresolvable sessions are dropped.
 */
export async function restoreSessions(client: BootstrapClient): Promise<void> {
    // In a multi-bot deployment only the first preferred bot restores on boot;
    // the others take over later through the lease watchdog.
    if (!client.shard && client.config.botPriority >= 0 && client.config.botPriority !== 0) return;
    const sessions = await client.db.getSessions();
    if (!sessions.length) return;
    client.logger.info(
        `[session] boot restore priority=${client.config.botPriority} sessions=${sessions.length}`
    );
    const botUser = client.user;
    if (!botUser) return;
    const botName = client.config.botName || botUser.username;

    // Per guild, in parallel: one guild waiting on an empty channel must not
    // hold up the others. Claim before joining so a fleet cannot restore the
    // same saved session twice.
    await Promise.all(
        sessions.map(async session => {
            if (!client.guilds.cache.has(session.guildId)) return;
            const claimed = await client.db
                .claimSessionLease(session.guildId, botUser.id, botName)
                .catch(() => false);
            if (!claimed) return;
            await restoreSession(client, session, botUser);
            if (!client.queue.has(session.guildId)) {
                await client.db.releaseSessionLease(session.guildId, botUser.id).catch(() => {});
            }
        })
    );
}

/** Delete pre-restart track panels; keep the setup mock and non-panel replies. */
export async function clearStaleNowPlaying(
    client: BootstrapClient,
    channel: TextChannel,
    setupMessageId: string | null
): Promise<void> {
    const botId = client.user?.id;
    if (!botId) return;
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages) return;
    const stale = messages.filter(
        (message: Message) =>
            message.author.id === botId &&
            message.id !== setupMessageId &&
            message.components.length > 0 &&
            message.embeds.some(embed => embed.author?.name === 'Now Playing')
    );
    await Promise.all(stale.map(message => message.delete().catch(() => {})));
}

/**
 * Restore one saved session.
 *
 * Permanent validation failures (expired row, missing/non-voice channel,
 * unparseable JSON, an empty voice channel after its wait window) delete the
 * row because no retry can fix them. Transport failures (rejoin, resolve,
 * playTrack) keep the row and back off: one Lavalink hiccup must not destroy a
 * 200-track queue, and the caller releases the lease so a later boot/handoff
 * tick can retry.
 */

/** Bounded retry cadence for transient failures: 15s doubling to 5 minutes. */
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
const restoreRetries = new Map<string, { failures: number; notBefore: number }>();

/** Test seam: forget transient-failure backoff between cases. */
export function resetRestoreRetries(): void {
    restoreRetries.clear();
}

function retryDelayMs(failures: number): number {
    return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(Math.max(failures, 1) - 1, 5));
}

export async function restoreSession(
    client: BootstrapClient,
    session: Session,
    botUser: User
): Promise<void> {
    const guildId = session.guildId;
    const backoff = restoreRetries.get(guildId);
    if (backoff && backoff.notBefore > Date.now()) {
        client.logger.debug(
            `[session] ${guildId}: retry backoff active, keeping the saved queue`
        );
        return;
    }
    const drop = async (reason: string): Promise<void> => {
        restoreRetries.delete(guildId);
        await client.db.deleteSession(guildId);
        client.logger.info(`[session] ${reason}`);
    };

    if (!isRestorable(session.updatedAt, client.config.sessionRestoreAge)) {
        return await drop(`guild ${guildId}: saved queue is older than the restore window`);
    }

    const guild = client.guilds.cache.get(guildId);
    const textChannel = guild?.channels.cache.get(session.textId);
    const voiceChannel = guild?.channels.cache.get(session.voiceId);
    if (!guild || !textChannel || !voiceChannel) {
        return await drop(`guild ${guildId}: channel no longer exists`);
    }
    if (
        voiceChannel.type !== ChannelType.GuildVoice &&
        voiceChannel.type !== ChannelType.GuildStageVoice
    ) {
        return await drop(`guild ${guildId}: saved channel is not a voice channel`);
    }

    const setup = await client.db.getSetup(guildId);
    if (textChannel instanceof TextChannel) {
        await clearStaleNowPlaying(client, textChannel, setup?.messageId ?? null);
    }

    // Restoring into an empty channel would play to nobody: the bot's own join
    // does not trigger the "everyone left" sweep. Wait a short window for
    // someone to arrive before discarding the queue. 24/7 skips the wait.
    const stay = await client.db.get_247(guildId);
    if (!stay && !hasListeners(voiceChannel.members.values())) {
        const window = client.config.sessionEmptyWait;
        if (window > 0) {
            client.logger.info(
                `[session] ${guild.name}: channel empty, waiting up to ${window}s for a listener`
            );
        }
        if (!(await waitForListeners(voiceChannel, window))) {
            return await drop(`${guild.name}: voice channel stayed empty, saved queue cleared`);
        }
    }

    let queued: SavedTrack[];
    let savedCurrent: (SavedTrack & { position: number }) | null;
    try {
        queued = JSON.parse(session.queue) as SavedTrack[];
        savedCurrent = session.current
            ? (JSON.parse(session.current) as SavedTrack & { position: number })
            : null;
    } catch {
        return await drop(`guild ${guildId}: saved session contains invalid JSON`);
    }

    let dispatcher: Dispatcher | null = null;
    let succeeded = false;
    try {
        dispatcher = await client.queue.create(guild, voiceChannel, textChannel);
        dispatcher.restoring = true;
        dispatcher.loop =
            session.loop === 'repeat' || session.loop === 'queue' ? session.loop : 'off';
        dispatcher.autoplay = session.autoplay;

        for (const saved of queued) dispatcher.queue.push(fromSaved(saved, botUser));

        if (!savedCurrent) {
            await dispatcher.play();
            dispatcher.restoring = false;
            client.logger.info(
                `[session] restored ${queued.length} queued track(s) in ${guild.name}`
            );
            succeeded = true;
            return;
        }

        const track =
            (await resolveSaved(client, savedCurrent)) ?? fromSaved(savedCurrent, botUser);
        dispatcher.current = track;
        dispatcher.history.push(track);
        dispatcher.skipRecentRecording = true;
        await dispatcher.player.setGlobalVolume(session.volume);
        await dispatcher.player.playTrack({
            track: { encoded: track.encoded },
            position: savedCurrent.position,
            volume: session.volume,
            paused: session.paused,
        });
        dispatcher.paused = session.paused;
        dispatcher.restoring = false;
        client.logger.info(
            `[session] resumed "${track.info.title}" at ${Math.round(
                savedCurrent.position / 1000
            )}s with ${queued.length} queued in ${guild.name}`
        );
        succeeded = true;
    } catch (error) {
        if (dispatcher) {
            dispatcher.restoring = false;
            dispatcher.destroy(true);
        }
        // Transport failures are retryable: keep the row and back off instead
        // of erasing a queue over one Lavalink hiccup.
        const failures = (restoreRetries.get(guildId)?.failures ?? 0) + 1;
        const delay = retryDelayMs(failures);
        restoreRetries.set(guildId, { failures, notBefore: Date.now() + delay });
        client.logger.warn(
            `[session] restore deferred for ${guildId} after a transport failure (attempt ${failures}, retry in ${Math.round(
                delay / 1000
            )}s); keeping the saved queue: ${error}`
        );
    } finally {
        if (dispatcher) dispatcher.restoring = false;
        if (succeeded) restoreRetries.delete(guildId);
    }
}
