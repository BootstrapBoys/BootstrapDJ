import { ChannelType, Message } from 'discord.js';
import { Player } from 'shoukaku';

import { Song } from '../../core/Dispatcher.js';
import { BootstrapClient, Dispatcher, Event } from '../../core/index.js';
import { updateSetup } from '../../lib/SetupSystem.js';
import { isFinishedTrackReason } from '../../lib/TrackEndReason.js';

export default class TrackEnd extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'trackEnd' });
    }

    private record(dispatcher: Dispatcher, track: Song): void {
        if (!track) return;
        void this.client.db
            .recordTrackPlay(
                dispatcher.guildId,
                track.info.uri ?? track.encoded,
                track.info.title,
                track.info.author,
                track.info.sourceName,
                Math.round(track.info.length / 1000),
                track.info.uri ?? null,
                track.autoplay ? null : track.info.requester?.id ?? null
            )
            .catch(() => {});
    }

    private async keep247(dispatcher: Dispatcher, track: Song, message: Message | undefined): Promise<boolean> {
        if (!dispatcher.pauseWhenEmpty) return false;
        const guild = this.client.guilds.cache.get(dispatcher.guildId);
        const stay = guild ? await this.client.db.get_247(guild.id).catch(() => null) : null;
        const channel = guild && dispatcher.voiceId ? guild.channels.cache.get(dispatcher.voiceId) : null;
        const listeners =
            channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
                ? channel.members.filter(member => !member.user.bot).size
                : 0;
        if (!stay || listeners > 0) {
            dispatcher.pauseWhenEmpty = false;
            return false;
        }
        if (!dispatcher.queue.length) dispatcher.queue.unshift(track);
        dispatcher.paused247 = true;
        dispatcher.pauseWhenEmpty = false;
        if (message?.deletable) await message.delete().catch(() => {});
        if (guild) await updateSetup(this.client, guild);
        return true;
    }

    public async run(
        _player: Player,
        track: Song,
        dispatcher: Dispatcher,
        reason?: string
    ): Promise<void> {
        this.record(dispatcher, track);
        dispatcher.previous = dispatcher.current;
        dispatcher.current = null;
        this.client.utils.updateStatus(this.client, dispatcher.guildId);
        dispatcher.nowPlayingCollector?.stop('trackEnd');
        dispatcher.nowPlayingCollector = null;
        dispatcher.clearNowPlayingCommandMessages();
        const message = await dispatcher.nowPlayingMessage?.fetch().catch(() => undefined);

        if (isFinishedTrackReason(reason)) {
            if (dispatcher.loop === 'repeat') dispatcher.queue.unshift(track);
            if (dispatcher.loop === 'queue') dispatcher.queue.push(track);
        }
        if (await this.keep247(dispatcher, track, message)) return;

        await dispatcher.play();
        if (dispatcher.autoplay) await dispatcher.ensureLookahead();
        if (message?.deletable) await message.delete().catch(() => {});
        if (!dispatcher.current) {
            const guild = this.client.guilds.cache.get(dispatcher.guildId);
            if (guild) await updateSetup(this.client, guild);
        }
    }
}
