import { Events } from 'discord.js';

import config from '../../config.js';
import { BootstrapClient, Event } from '../../core/index.js';
import { restoreSessions, startSessionHandoffs, waitForNode } from '../../lib/Session.js';
import { resetSetupChannel, startSetupJanitor } from '../../lib/SetupSystem.js';

let channelsPurged = false;
export default class Ready extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: Events.ClientReady,
        });
    }
    public async run(): Promise<void> {
        this.client.logger.success(`${this.client.user?.tag} is ready!`);
        this.client.logger.info(
            `[boot] ${this.client.user?.tag} priority=${this.client.config.botPriority} botsFile=${Boolean(this.client.config.botsFile)}`
        );

        // Presence is account-wide. In a shard group only the coordinator may
        // set it, or a late shard's static presence overwrites the aggregate.
        if (!this.client.shard || this.client.isCoordinator) {
            this.client.user?.setPresence({
                activities: [
                    {
                        name: config.botActivity,
                        type: config.botActivityType,
                    },
                ],
                status: config.botStatus,
            });
        }

        const firstReady = !channelsPurged;
        channelsPurged = true;
        if (firstReady) {
            // A setup-channel failure must never prevent queue restore or the
            // lease watchdog from starting.
            try {
                const setups = await this.client.db.getSetups();
                for (const setup of setups) {
                    // A shard only owns a subset of guilds; purging or starting
                    // a janitor for another shard's setup is wasted and noisy.
                    if (!this.client.guilds.cache.has(setup.guildId)) continue;
                    try {
                        await resetSetupChannel(this.client, setup);
                        startSetupJanitor(this.client, setup.guildId);
                    } catch (error) {
                        this.client.logger.error(`[setup] ${setup.guildId} cleanup failed: ${error}`);
                    }
                }
            } catch (error) {
                this.client.logger.error(`[setup] could not load setup channels: ${error}`);
            }

            try {
                // Use the full node wait: Lavalink can start well after the
                // gateway, and a short timeout permanently drops the queue.
                if (await waitForNode(this.client)) await restoreSessions(this.client);
                else this.client.logger.error('[session] no node available after waiting; skipping restore');
            } catch (error) {
                this.client.logger.error(`[session] restore pass failed: ${error}`);
            } finally {
                startSessionHandoffs(this.client);
            }
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
