import { BootstrapClient, Event } from '../../structures/index.js';
import BotLog from '../../utils/BotLog.js';
import { isPrimaryNode } from '../../utils/NodeConfig.js';
import { endIncident, formatDuration } from '../../utils/NodeStatus.js';
import { isFallbackNode } from '../../utils/PublicNodes.js';

export default class NodeConnect extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'nodeConnect',
        });
    }
    public async run(node: string): Promise<void> {
        const configured = this.client.config.lavalink.map(option => option.name);
        if (!isFallbackNode(node) && configured.includes(node) && !isPrimaryNode(node, configured)) {
            this.client.logger.info(`[nodes] standby node "${node}" is ready`);
            return;
        }

        if (isFallbackNode(node)) {
            const message = `Public fallback node "${node}" is handling playback — the configured nodes are still down.`;
            this.client.logger.warn(message);
        } else {
            const recoveredMs = endIncident();
            if (recoveredMs === null) {
                const ready = `Lavalink node "${node}" is ready!`;
                this.client.logger.success(ready);
                BotLog.send(this.client, ready, 'success');
            } else {
                const recovered = `Lavalink node "${node}" recovered after ${formatDuration(recoveredMs)}.`;
                this.client.logger.success(recovered);
                BotLog.send(this.client, recovered, 'success');
            }
        }

        // Switch back: anything playing on a standby returns to this node.
        const primary = this.client.shoukaku.nodes.get(node);
        if (primary) {
            void this.client.queue
                .migrateToNode(primary)
                .then(moved => {
                    if (moved) this.client.logger.success(`[nodes] moved ${moved} player(s) back to "${node}"`);
                })
                .catch(error => this.client.logger.error(`[nodes] switch-back migration failed: ${error}`));
        }

        let data = await this.client.db.get_247();
        if (!data) return;
        if (!Array.isArray(data)) {
            data = [data];
        }
        for (const main of data) {
            const index = data.indexOf(main);
            setTimeout(async () => {
                const guild = this.client.guilds.cache.get(main.guildId);
                if (!guild) return;
                const channel = guild.channels.cache.get(main.textId);
                if (!channel) return;
                const vc = guild.channels.cache.get(main.voiceId);
                if (!vc) return;
                await this.client.queue.create(guild, vc, channel);
            }, index * 1000);
        }
    }
}
