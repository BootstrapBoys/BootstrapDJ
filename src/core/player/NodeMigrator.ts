import type { Channel, Guild } from 'discord.js';
import type { Node } from 'shoukaku';

import type Dispatcher from '../Dispatcher.js';
import type { BootstrapClient } from '../index.js';
import type { PlaybackLoggerPort } from './PlaybackEngine.js';

/** Playback state that survives a player rebuild on another Lavalink node. */
export interface ResumableState {
    current: Dispatcher['current'];
    queue: Dispatcher['queue'];
    history: Dispatcher['history'];
    previous: Dispatcher['previous'];
    loop: Dispatcher['loop'];
    autoplay: boolean;
    seed: Dispatcher['seed'];
    seeds: Dispatcher['seeds'];
    filters: Dispatcher['filters'];
    filterValues: Dispatcher['filterValues'];
    leaveOnEnd: boolean;
    pauseWhenEmpty: boolean;
    dashboardMode: boolean;
    dashboardVoiceChannelId: string | null;
    paused247: boolean;
    skipRecentRecording: boolean;
    pendingDefaultShuffle: boolean;
    volume: number;
    position: number;
    paused: boolean;
}

export type SpawnDispatcher = (
    guild: Guild,
    voice: Channel,
    channel: Channel,
    node: Node
) => Promise<Dispatcher>;

/**
 * Moves one guild's playback to another Lavalink node: sample the position
 * before teardown, destroy the old player while preserving the saved session,
 * spawn the replacement, transfer queue/current/history once and resume at the
 * sampled position. A failed rebuild returns null and leaves the old saved
 * session intact so a later attempt can recover it.
 */
export class NodeMigrator {
    private readonly moving = new Set<string>();

    public constructor(
        private readonly client: BootstrapClient,
        private readonly spawn: SpawnDispatcher,
        private readonly logger: PlaybackLoggerPort
    ) {}

    public snapshot(dispatcher: Dispatcher): ResumableState {
        return {
            current: dispatcher.current,
            queue: dispatcher.queue.slice(),
            history: dispatcher.history.slice(),
            previous: dispatcher.previous ?? null,
            loop: dispatcher.loop,
            autoplay: dispatcher.autoplay,
            seed: dispatcher.seed,
            seeds: dispatcher.seeds.slice(),
            filters: [...(dispatcher.filters ?? [])],
            filterValues: Object.assign({}, dispatcher.filterValues),
            leaveOnEnd: dispatcher.leaveOnEnd ?? false,
            pauseWhenEmpty: dispatcher.pauseWhenEmpty ?? false,
            dashboardMode: dispatcher.dashboardMode ?? false,
            dashboardVoiceChannelId: dispatcher.dashboardVoiceChannelId ?? null,
            paused247: dispatcher.paused247 ?? false,
            skipRecentRecording: dispatcher.skipRecentRecording ?? false,
            pendingDefaultShuffle: dispatcher.pendingDefaultShuffle ?? false,
            volume: dispatcher.volume,
            position:
                dispatcher.resumePosition ??
                (Number.isFinite(dispatcher.player.position) ? dispatcher.player.position : 0),
            paused: dispatcher.paused,
        };
    }

    public async rebuild(
        dispatcher: Dispatcher,
        node: Node | undefined
    ): Promise<Dispatcher | null> {
        if (this.moving.has(dispatcher.guildId)) return null;
        this.moving.add(dispatcher.guildId);
        try {
            return await this.doRebuild(dispatcher, node);
        } finally {
            this.moving.delete(dispatcher.guildId);
        }
    }

    private async doRebuild(
        dispatcher: Dispatcher,
        node: Node | undefined
    ): Promise<Dispatcher | null> {
        if (!node || !dispatcher.channelId || !dispatcher.voiceId) {
            this.logger.warn(
                `[queue] cannot rebuild ${dispatcher.guildId}: node=${Boolean(node)} text=${Boolean(
                    dispatcher.channelId
                )} voice=${Boolean(dispatcher.voiceId)}`
            );
            return null;
        }
        const guild = this.client.guilds.cache.get(dispatcher.guildId);
        const voice = guild?.channels.cache.get(dispatcher.voiceId);
        const channel = guild?.channels.cache.get(dispatcher.channelId);
        if (!guild || !voice || !channel) {
            this.logger.warn(
                `[queue] cannot rebuild ${dispatcher.guildId}: guild=${Boolean(guild)} voice=${Boolean(voice)} channel=${Boolean(channel)}`
            );
            return null;
        }

        const state = this.snapshot(dispatcher);
        this.logger.info(
            `[queue] rebuilding ${dispatcher.guildId} on "${node.name}" (was "${dispatcher.player.node?.name}")`
        );
        await dispatcher.destroyAndWait(true);

        let rebuilt: Dispatcher | null = null;
        try {
            rebuilt = await this.spawn(guild, voice, channel, node);
            rebuilt.current = null;
            rebuilt.queue = state.current ? [state.current, ...state.queue] : state.queue;
            rebuilt.history = state.history;
            rebuilt.previous = state.previous;
            rebuilt.loop = state.loop;
            rebuilt.autoplay = state.autoplay;
            rebuilt.seed = state.seed;
            rebuilt.seeds = state.seeds;
            rebuilt.filters = state.filters;
            rebuilt.filterValues = state.filterValues;
            rebuilt.leaveOnEnd = state.leaveOnEnd;
            rebuilt.pauseWhenEmpty = state.pauseWhenEmpty;
            rebuilt.dashboardMode = state.dashboardMode;
            rebuilt.dashboardVoiceChannelId = state.dashboardVoiceChannelId;
            rebuilt.paused247 = state.paused247;
            rebuilt.skipRecentRecording = state.skipRecentRecording;
            rebuilt.pendingDefaultShuffle = state.pendingDefaultShuffle;
            // Awaited so the default volume applied by the spawn cannot land
            // after the migrated volume and silently overwrite it.
            await rebuilt.player.setGlobalVolume(state.volume).catch(error => {
                this.logger.warn(`[queue] could not restore volume on ${node.name}: ${error}`);
            });
            this.client.shoukaku.emitPlayerEvent('playerCreate', rebuilt.player);

            let resumedAt = 0;
            if (state.current) {
                await rebuilt.play();
                if (state.position > 1000 && rebuilt.player.track) {
                    try {
                        await rebuilt.player.seekTo(state.position);
                        resumedAt = state.position;
                    } catch (error) {
                        this.logger.warn(`[queue] seek to ${state.position}ms failed: ${error}`);
                    }
                }
                if (state.paused) {
                    try {
                        await rebuilt.player.setPaused(true);
                        rebuilt.paused = true;
                    } catch (error) {
                        this.logger.warn(`[queue] could not restore paused state: ${error}`);
                    }
                }
                rebuilt.resumePosition = null;
            }
            this.logger.info(
                `[queue] moved ${guild.id} to "${node.name}" (${state.queue.length} queued${
                    resumedAt ? `, resumed at ${Math.round(resumedAt / 1000)}s` : ''
                })`
            );
            return rebuilt;
        } catch (error) {
            // The old player is already gone. A replacement that failed midway
            // must not stay registered with a half-restored queue, or the next
            // command sees a live dispatcher that cannot play. Keep the saved
            // session so a later boot/lease tick can retry.
            if (rebuilt) {
                try {
                    rebuilt.destroy(true);
                } catch (cleanupError) {
                    this.logger.warn(
                        `[queue] could not clean up failed rebuild for ${guild.id}: ${cleanupError}`
                    );
                }
            }
            this.logger.error(
                `[queue] could not move ${guild.id} to "${node.name}": ${error} (saved session kept)`
            );
            return null;
        }
    }
}
