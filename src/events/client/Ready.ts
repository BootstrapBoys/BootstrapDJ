import { Events } from 'discord.js';

import config from '../../config.js';
import { BootstrapClient, Event } from '../../core/index.js';
import { restoreSessions, startSessionHandoffs, waitForNode } from '../../lib/Session.js';
import { resetSetupChannel, startSetupJanitor } from '../../lib/SetupSystem.js';

let initialized = false;

export default class Ready extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: Events.ClientReady });
    }

    private setPresence(): void {
        if (this.client.shard && !this.client.isCoordinator) return;
        this.client.user?.setPresence({
            activities: [{ name: config.botActivity, type: config.botActivityType }],
            status: config.botStatus,
        });
    }

    private async initializeSetups(): Promise<void> {
        try {
            const setups = await this.client.db.getSetups();
            for (const setup of setups) {
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
    }

    private async restore(): Promise<void> {
        try {
            if (await waitForNode(this.client)) await restoreSessions(this.client);
            else this.client.logger.error('[session] no node available after waiting; skipping restore');
        } catch (error) {
            this.client.logger.error(`[session] restore pass failed: ${error}`);
        } finally {
            startSessionHandoffs(this.client);
        }
    }

    public async run(): Promise<void> {
        this.client.logger.success(`${this.client.user?.tag} is ready!`);
        this.client.logger.info(
            `[boot] ${this.client.user?.tag} priority=${this.client.config.botPriority} botsFile=${Boolean(
                this.client.config.botsFile
            )}`
        );
        this.setPresence();
        if (initialized) return;
        initialized = true;
        await this.initializeSetups();
        await this.restore();
    }
}
