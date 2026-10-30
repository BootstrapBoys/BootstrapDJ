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
    public async run(player: Player, track: Song, dispatcher: Dispatcher): Promise<void> {
        dispatcher.previous = dispatcher.current;
        dispatcher.current = null;
        const m = await dispatcher.nowPlayingMessage?.fetch().catch(() => {});
        if (dispatcher.loop === 'repeat') dispatcher.queue.unshift(track);
        if (dispatcher.loop === 'queue') dispatcher.queue.push(track);
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
