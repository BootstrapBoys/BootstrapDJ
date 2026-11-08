import type { Player } from 'shoukaku';

import type { BootstrapClient } from '../../core/index.js';
import { Event } from '../../core/index.js';
import { updateSetup } from '../../lib/SetupSystem.js';
import { clearVoteSkip } from '../../commands/music/VoteSkip.js';
import { cancelEndTime } from '../../commands/music/EndTime.js';

/**
 * Destroy can happen without a TrackEnd: an empty voice channel, /leave, or a
 * node rebuild. The mock would otherwise keep showing the last track, so
 * refresh it once the teardown has settled — unless a replacement dispatcher
 * has already been installed for the guild.
 */
export default class PlayerDestroy extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'playerDestroy' });
    }

    public async run(player: Player): Promise<void> {
        const guildId = player.guildId;
        clearVoteSkip(guildId);
        cancelEndTime(guildId);
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        setTimeout(() => {
            if (this.client.queue.get(guildId)) return;
            void updateSetup(this.client, guild).catch(error =>
                this.client.logger.warn(
                    `[setup] playerDestroy reset failed for ${guildId}: ${error}`
                )
            );
        }, 750);
    }
}
