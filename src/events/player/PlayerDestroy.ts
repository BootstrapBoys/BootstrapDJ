import { Player } from 'shoukaku';

import { BootstrapClient, Event } from '../../core/index.js';
import { updateSetup } from '../../lib/SetupSystem.js';

/**
 * A dispatcher can be destroyed without reaching TrackEnd: the channel empties
 * (AFK users are moved to the AFK channel), /leave runs, or a node rebuild
 * replaces the player. Destroy removes the queue and session but nothing
 * rerendered the mock, so it kept showing the last track. Reset it once the
 * destroy has settled; skip it when a rebuild has already installed a new
 * dispatcher for the same guild.
 */
export default class PlayerDestroy extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'playerDestroy',
        });
    }
    public async run(player: Player): Promise<void> {
        const guildId = player.guildId;
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;
        setTimeout(() => {
            if (this.client.queue.get(guildId)) return;
            void updateSetup(this.client, guild).catch(error =>
                this.client.logger.warn(`[setup] playerDestroy reset failed for ${guildId}: ${error}`)
            );
        }, 750);
    }
}
