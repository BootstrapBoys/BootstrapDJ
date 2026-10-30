import { Player } from 'shoukaku';

import { Song } from '../../structures/Dispatcher.js';
import { BootstrapClient, Dispatcher, Event } from '../../structures/index.js';

export default class QueueEnd extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'queueEnd',
        });
    }
    public async run(player: Player, track: Song, dispatcher: Dispatcher): Promise<void> {
        const guild = this.client.guilds.cache.get(dispatcher.guildId);
        if (!guild) return;
        // TrackEnd owns loop modes, autoplay and previous/current bookkeeping: it fires
        // alongside this event, so repeating that work here queued every looped track
        // twice and started two autoplay tracks whenever the queue drained.
        this.client.utils.updateStatus(this.client, guild.id);
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
