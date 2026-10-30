import { ChannelType, TextChannel } from 'discord.js';
import { LoadType } from 'shoukaku';

import { fromSaved, SavedTrack, Song } from '../structures/Dispatcher.js';
import { Dispatcher, Lavamusic } from '../structures/index.js';

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

/**
 * Rebuild players for sessions left behind by a crash or restart: rejoin the
 * voice channel, restore volume/loop/autoplay, resume the current track at its
 * saved position and re-queue the rest. Unresolvable sessions are dropped.
 */
export async function restoreSessions(client: Lavamusic): Promise<void> {
    const sessions = await client.db.getSessions();
    if (!sessions.length) return;

    const maxAge = client.config.sessionRestoreAge;
    const botUser = client.user;
    if (!botUser) return;

    for (const session of sessions) {
        if (!isRestorable(session.updatedAt, maxAge)) {
            await client.db.deleteSession(session.guildId);
            continue;
        }

        const guild = client.guilds.cache.get(session.guildId);
        const textChannel = guild?.channels.cache.get(session.textId);
        const voiceChannel = guild?.channels.cache.get(session.voiceId);
        const isVoiceChannel =
            voiceChannel?.type === ChannelType.GuildVoice ||
            voiceChannel?.type === ChannelType.GuildStageVoice;
        if (!guild || !textChannel || !voiceChannel || !isVoiceChannel) {
            await client.db.deleteSession(session.guildId);
            continue;
        }

        try {
            const dispatcher = await client.queue.create(
                guild,
                voiceChannel,
                textChannel as TextChannel
            );
            dispatcher.loop = (session.loop as Dispatcher['loop']) ?? 'off';
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
                continue;
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
            client.logger.error(`[session] restore failed for ${session.guildId}: ${error}`);
        }
    }
}
