import { BootstrapClient, Event } from '../../core/index.js';
import BotLog from '../../lib/BotLog.js';
import { isPrimaryNode } from '../../lib/NodeConfig.js';
import { beginIncident, describeCloseCode, formatDuration } from '../../lib/NodeStatus.js';
import { isFallbackNode, markFallbackFailed } from '../../lib/PublicNodes.js';

export default class NodeDestroy extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'nodeDestroy' });
    }

    private async fallback(node: string, code: number, reason: string): Promise<void> {
        markFallbackFailed(node);
        try {
            this.client.shoukaku.removeNode(node, 'fallback lost');
        } catch (error) {
            this.client.logger.debug(`[nodes] could not remove fallback ${node}: ${error}`);
        }
        const detail = reason.trim() ? ` (${reason.trim()})` : '';
        this.client.logger.debug(`[nodes] public fallback "${node}" closed: code ${code}${detail}`);
        this.client.logger.warn(`Public fallback node "${node}" was lost — trying another node.`);
    }

    private failOver(node: string): void {
        this.client.queue.holdPositions(node);
        const target = [...this.client.shoukaku.nodes.values()].find(
            candidate => candidate.name !== node && Number(candidate.state) === 1
        );
        void this.client.queue
            .migrateToNode(target)
            .then(moved => {
                if (moved) this.client.logger.warn(`[nodes] moved ${moved} player(s) off "${node}"`);
            })
            .catch(error => this.client.logger.error(`[nodes] failover migration failed: ${error}`));
    }

    public async run(node: string, code: number, reason: string): Promise<void> {
        const configured = this.client.config.lavalink.map(option => option.name);
        if (!isFallbackNode(node) && configured.includes(node) && !isPrimaryNode(node, configured)) {
            this.client.logger.warn(`[nodes] standby node "${node}" disconnected`);
            return;
        }
        if (isFallbackNode(node)) {
            await this.fallback(node, code, reason);
            return;
        }

        const info = describeCloseCode(code);
        const detail = reason.trim() ? ` — ${reason.trim()}` : '';
        const incident = beginIncident();
        if (!incident.started) {
            this.client.logger.debug(
                `[nodes] still down (${formatDuration(incident.durationMs)}): ${info.summary} (code ${code})`
            );
            return;
        }

        const message = `Lavalink node "${node}" is down: ${info.summary} (code ${code})${detail}. Retrying in the background.`;
        if (info.expected) this.client.logger.warn(message);
        else this.client.logger.error(message);
        BotLog.send(this.client, message, info.expected ? 'warn' : 'error');
        this.failOver(node);
    }
}
