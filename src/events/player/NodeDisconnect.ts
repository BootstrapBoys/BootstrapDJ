import type { BootstrapClient } from '../../core/index.js';
import { Event } from '../../core/index.js';
import { DEFAULT_LANGUAGE, translate } from '../../lib/i18n.js';
import BotLog from '../../lib/BotLog.js';
import { beginIncident, formatDuration } from '../../lib/NodeStatus.js';

export default class NodeDisconnect extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'nodeDisconnect' });
    }

    public async run(node: string, count: number): Promise<void> {
        const incident = beginIncident(node);
        if (!incident.started) {
            this.client.logger.debug(
                `[nodes] disconnect #${count} (${formatDuration(incident.durationMs)} into the outage)`
            );
            return;
        }
        const message = translate(
            'longtail:events.nodes.disconnect',
            this.client.config.defaultLanguage ?? DEFAULT_LANGUAGE,
            { node, count }
        );
        this.client.logger.warn(message);
        BotLog.send(this.client, message, 'warn');
    }
}
