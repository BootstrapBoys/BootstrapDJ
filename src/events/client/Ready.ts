import config from '../../config.js';
import { Event, Lavamusic } from '../../structures/index.js';
import { resetSetupChannel, startSetupJanitor } from '../../utils/SetupSystem.js';

let channelsPurged = false;
export default class Ready extends Event {
    constructor(client: Lavamusic, file: string) {
        super(client, file, {
            name: 'ready',
        });
    }
    public async run(): Promise<void> {
        this.client.logger.success(`${this.client.user?.tag} is ready!`);

        this.client.user?.setPresence({
            activities: [
                {
                    name: config.botActivity,
                    type: config.botActivityType,
                },
            ],
            status: config.botStatus as any,
        });

        try {
            const setups = await this.client.db.getSetups();
            for (const setup of setups) {
                // Purge only on the first ready of this process; a reconnect fires
                // ready again and must not wipe the channel each time.
                if (!channelsPurged) await resetSetupChannel(this.client, setup);
                startSetupJanitor(this.client, setup.guildId);
            }
        } catch (error) {
            this.client.logger.error(`[setup] startup cleanup failed: ${error}`);
        } finally {
            channelsPurged = true;
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
