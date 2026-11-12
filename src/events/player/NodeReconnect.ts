import type { BootstrapClient } from '../../core/index.js';
import { Event } from '../../core/index.js';
import { DEFAULT_LANGUAGE, translate } from '../../lib/i18n.js';
import BotLog from '../../lib/BotLog.js';
import { isPrimaryNode } from '../../lib/NodeConfig.js';
import { endIncident, formatDuration } from '../../lib/NodeStatus.js';
import { isFallbackNode } from '../../lib/PublicNodes.js';

export default class NodeReconnect extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'nodeReconnect' });
    }

    public async run(node: string): Promise<void> {
        const configured = this.client.config.lavalink.map(option => option.name);
        if (
            !isFallbackNode(node) &&
            configured.includes(node) &&
            !isPrimaryNode(node, configured)
        ) {
            this.client.logger.info(`[nodes] standby node "${node}" reconnected`);
            return;
        }
        if (isFallbackNode(node)) {
            this.client.logger.warn(
                `Public fallback node "${node}" reconnected — the configured nodes are still down.`
            );
            return;
        }

        const recoveredMs = endIncident(node);
        const message =
            recoveredMs === null
                ? translate(
                      'longtail:events.nodes.reconnected',
                      this.client.config.defaultLanguage ?? DEFAULT_LANGUAGE,
                      { node }
                  )
                : translate(
                      'longtail:events.nodes.recovered',
                      this.client.config.defaultLanguage ?? DEFAULT_LANGUAGE,
                      { node, duration: formatDuration(recoveredMs) }
                  );
        this.client.logger.success(message);
        BotLog.send(this.client, message, 'success');
    }
}
