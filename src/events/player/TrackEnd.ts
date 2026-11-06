import { ChannelType } from 'discord.js';
import { Player } from 'shoukaku';

import { Song } from '../../structures/Dispatcher.js';
import { BootstrapClient, Dispatcher, Event } from '../../structures/index.js';
import { updateSetup } from '../../utils/SetupSystem.js';

export default class TrackEnd extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'trackEnd',
        });
    }
    public async run(
        _player: Player,
        track: Song,
        dispatcher: Dispatcher,
        reason?: string
    ): Promise<void> {
        if (track) {
            void this.client.db.recordTrackPlay(
                dispatcher.guildId,
                track.info.uri ?? track.encoded,
                track.info.title,
                track.info.author,
                track.info.sourceName,
                Math.round(track.info.length / 1000),
                track.info.uri ?? null
            ).catch(() => {});
        }
        dispatcher.previous = dispatcher.current;
        dispatcher.current = null;
        // QueueEnd alone is too early: it fires before this handler clears
        // current, so a track-title status would stay on the old song. Update
        // after the authoritative current->null transition as well.
        this.client.utils.updateStatus(this.client, dispatcher.guildId);
        dispatcher.nowPlayingCollector?.stop('trackEnd');
        dispatcher.nowPlayingCollector = null;
        dispatcher.clearNowPlayingCommandMessages();
        const m = await dispatcher.nowPlayingMessage?.fetch().catch(() => {});
        // Only a natural end repeats; STOPPED (skip/stop/previous) must not
        // requeue the track it was asked to leave.
        if (reason === 'FINISHED') {
            if (dispatcher.loop === 'repeat') dispatcher.queue.unshift(track);
            if (dispatcher.loop === 'queue') dispatcher.queue.push(track);
        }
        if (dispatcher.pauseWhenEmpty) {
            const guild = this.client.guilds.cache.get(dispatcher.guildId);
            const stay = guild ? await this.client.db.get_247(guild.id).catch(() => null) : null;
            const channel = guild && dispatcher.voiceId ? guild.channels.cache.get(dispatcher.voiceId) : null;
            const listeners =
                channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
                    ? channel.members.filter(member => !member.user.bot).size
                    : 0;
            if (stay && listeners === 0) {
                if (!dispatcher.queue.length) dispatcher.queue.unshift(track);
                dispatcher.paused247 = true;
                dispatcher.pauseWhenEmpty = false;
                if (m && m.deletable) await m.delete().catch(() => {});
                if (guild) await updateSetup(this.client, guild);
                return;
            }
            dispatcher.pauseWhenEmpty = false;
        }
        await dispatcher.play();
        // Keep one bot pick waiting so /skip always has a target. The
        // ensureLookahead lock makes this safe alongside the TrackStart call.
        if (dispatcher.autoplay) {
            await dispatcher.ensureLookahead();
        }
        if (m && m.deletable) await m.delete().catch(() => {});
        if (!dispatcher.current) {
            const guild = this.client.guilds.cache.get(dispatcher.guildId);
            if (guild) await updateSetup(this.client, guild);
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
