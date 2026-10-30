import { ChannelType, User } from 'discord.js';
import { LoadType } from 'shoukaku';

import { Session } from '../generated/prisma/client.js';
import { fromSaved, SavedTrack, Song } from '../structures/Dispatcher.js';
import { Lavamusic } from '../structures/index.js';

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
export function isRestorable(updatedAt: Date, maxAgeSeconds: number, now: number = Date.now()): boolean {
    if (maxAgeSeconds <= 0) return false;
    return now - updatedAt.getTime() <= maxAgeSeconds * 1000;
}

/** `ready` fires before Lavalink nodes connect; restoring needs a node. */
export async function waitForNode(client: Lavamusic, timeoutMs: number = 20_000): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (client.queue.hasNode) return true;
        await new Promise<void>((resolve: () => void) => setTimeout(resolve, 500));
    }
    return client.queue.hasNode;
}

/**
 * Re-resolve a saved track so its encoded payload is fresh for this process.
 * Stored tokens can expire — LavaSrc stamps a per-search token into `encoded`.
 */
async function resolveSaved(client: Lavamusic, saved: SavedTrack): Promise<Song | null> {
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
export async function restoreSessions(client: Lavamusic): Promise<void> {
    const sessions = await client.db.getSessions();
    if (!sessions.length) return;
    const botUser = client.user;
    if (!botUser) return;

    // Per guild, in parallel: one guild waiting on an empty channel must not
    // hold up the others.
    await Promise.all(sessions.map(session => restoreSession(client, session, botUser)));
}

async function restoreSession(client: Lavamusic, session: Session, botUser: User): Promise<void> {
    const guildId = session.guildId;
    const drop = async (reason: string): Promise<void> => {
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
            return await drop(
                `${guild.name}: voice channel stayed empty, saved queue cleared`
            );
        }
    }

    try {
        const dispatcher = await client.queue.create(
            guild,
            voiceChannel,
            textChannel
        );
        dispatcher.loop =
            session.loop === 'repeat' || session.loop === 'queue' ? session.loop : 'off';
        dispatcher.autoplay = session.autoplay;

        const queued = JSON.parse(session.queue) as SavedTrack[];
        for (const saved of queued) dispatcher.queue.push(fromSaved(saved, botUser));

        const savedCurrent = session.current
            ? (JSON.parse(session.current) as SavedTrack & { position: number })
            : null;

        if (!savedCurrent) {
            await dispatcher.play();
            client.logger.info(
                `[session] restored ${queued.length} queued track(s) in ${guild.name}`
            );
            return;
        }

        const track =
            (await resolveSaved(client, savedCurrent)) ?? fromSaved(savedCurrent, botUser);
        dispatcher.current = track;
        dispatcher.history.push(track);
        await dispatcher.player.setGlobalVolume(session.volume);
        await dispatcher.player.playTrack({
            track: { encoded: track.encoded },
            position: savedCurrent.position,
            volume: session.volume,
            paused: session.paused,
        });
        dispatcher.paused = session.paused;
        client.logger.info(
            `[session] resumed "${track.info.title}" at ${Math.round(
                savedCurrent.position / 1000
            )}s with ${queued.length} queued in ${guild.name}`
        );
    } catch (error) {
        client.logger.error(`[session] restore failed for ${guildId}: ${error}`);
    }
}
