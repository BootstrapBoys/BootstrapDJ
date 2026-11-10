import type { Song } from '../core/Dispatcher.js';
import type { BootstrapClient, Context } from '../core/index.js';
import { LoadType } from 'shoukaku';

import { checkTrack, getPlayLimits } from './PlayLimits.js';
import { resolveSearchEngine } from './SearchEngine.js';

export type PlayMode = 'queue' | 'next';

/**
 * Resolve and enqueue a /play or /playnext request. Both commands share the
 * Lavalink search, playlist limits, rejection wording and response lifetime;
 * only the insertion direction and a few labels differ.
 */
export async function runPlayRequest(
    client: BootstrapClient,
    ctx: Context,
    args: string[],
    mode: PlayMode
): Promise<void> {
    const query = args.join(' ');
    const guild = ctx.guild;
    const author = ctx.author;
    if (!guild || !author) return;

    const guildSettings: Record<string, string> = await client.db
        .getGuildSettings(guild.id)
        .catch(() => ({}));
    const dashboardPriority = (guildSettings.dashboardvoicepriority ?? 'true') !== 'false';

    let player = client.queue.get(guild.id);
    const vc = ctx.voiceChannel;
    if (!client.queue.hasNode) {
        await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.red)
                    .setDescription(
                        'No Lavalink node is available right now. Please try again in a moment.'
                    ),
            ],
        });
        return;
    }

    const limits = await getPlayLimits(client, guild.id);
    const searchEngine = await resolveSearchEngine(client, ctx, guildSettings);
    const res = await client.queue.search(query, searchEngine);
    const embed = client.embed();
    const destination = mode === 'next' ? 'to play next in the queue' : 'to the queue';

    if (!res) {
        await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(client.color.red)
                    .setDescription('There was an error while searching. Please try again.'),
            ],
        });
        return;
    }

    if (res.loadType === LoadType.ERROR) {
        const exception = res.data as {
            message?: string;
            severity?: string;
            cause?: string;
        };
        const detail = exception?.cause || exception?.message || 'unknown';
        client.logger.error(`Lavalink load error for ${query}: ${detail}`);
        await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(client.color.red)
                    .setDescription('There was an error while searching.'),
            ],
        });
        return;
    }
    if (res.loadType === LoadType.EMPTY) {
        await ctx.sendMessage({
            embeds: [
                embed.setColor(client.color.red).setDescription('There were no results found.'),
            ],
        });
        return;
    }
    if (res.loadType === LoadType.SEARCH && !res.data[0]) {
        await ctx.sendMessage({
            embeds: [
                embed.setColor(client.color.red).setDescription('There were no results found.'),
            ],
        });
        return;
    }
    if (
        res.loadType === LoadType.PLAYLIST &&
        res.data.tracks.length > client.config.maxPlaylistSize
    ) {
        await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(client.color.red)
                    .setDescription(
                        `The playlist is too long. The maximum length is ${client.config.maxPlaylistSize} songs.`
                    ),
            ],
        });
        return;
    }

    // Only take over a browser-only session after the request resolves to
    // something playable. An invalid search must not wipe the browser queue.
    if (player?.dashboardMode && dashboardPriority && vc && player.voiceId !== vc.id) {
        await player.destroyAndWait();
        player = undefined;
    }
    if (!player || player.isStale) player = await client.queue.create(guild, vc, ctx.channel);
    if (player.dashboardMode) player.dashboardMode = false;

    switch (res.loadType) {
        case LoadType.TRACK: {
            const track = player.buildTrack(res.data, author);
            const rejected = checkTrack(player, track, author.id, limits);
            if (rejected) {
                await ctx.sendMessage({
                    embeds: [embed.setColor(client.color.red).setDescription(rejected)],
                });
                return;
            }
            if (mode === 'next') player.enqueueNext(track);
            else player.enqueue(track);
            await player.isPlaying();
            await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.main)
                        .setDescription(
                            `Added [${res.data.info.title}](${res.data.info.uri}) ${destination}.`
                        ),
                ],
            });
            return;
        }
        case LoadType.PLAYLIST: {
            const accepted: Song[] = [];
            let playlistDuration = 0;
            for (const track of res.data.tracks.slice(0, limits.maxPlaylistTracks || undefined)) {
                const trackLength = track.info.isStream ? 0 : track.info.length;
                if (
                    limits.maxPlaylistLength > 0 &&
                    playlistDuration + trackLength > limits.maxPlaylistLength * 1000
                ) {
                    break;
                }
                playlistDuration += trackLength;
                const pl = player.buildTrack(track, author);
                const pending = mode === 'next' ? accepted : [];
                const rejected = checkTrack(player, pl, author.id, limits, pending);
                if (rejected) continue;
                accepted.push(pl);
                if (mode === 'queue') player.enqueue(pl, false, false);
            }
            if (mode === 'next') {
                // enqueueNext unshifts; reverse the batch so the playlist keeps
                // its original order at the front of the queue.
                for (let index = accepted.length - 1; index >= 0; index--) {
                    player.enqueueNext(accepted[index], true, false);
                }
            }
            if (mode === 'queue') player.seedPlaylist(accepted);
            void player.persist();
            await player.isPlaying();
            await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.main)
                        .setDescription(`Added ${accepted.length} songs ${destination}.`),
                ],
            });
            return;
        }
        case LoadType.SEARCH: {
            const first = res.data[0];
            if (!first) {
                await ctx.sendMessage({
                    embeds: [
                        embed
                            .setColor(client.color.red)
                            .setDescription('There were no results found.'),
                    ],
                });
                return;
            }
            const track = player.buildTrack(first, author);
            const rejected = checkTrack(player, track, author.id, limits);
            if (rejected) {
                await ctx.sendMessage({
                    embeds: [embed.setColor(client.color.red).setDescription(rejected)],
                });
                return;
            }
            if (mode === 'next') player.enqueueNext(track);
            else player.enqueue(track);
            await player.isPlaying();
            await ctx.sendMessage({
                embeds: [
                    embed
                        .setColor(client.color.main)
                        .setDescription(
                            `Added [${first.info.title}](${first.info.uri}) ${destination}.`
                        ),
                ],
            });
            return;
        }
    }
}
