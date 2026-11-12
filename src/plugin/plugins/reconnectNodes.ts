import { Constants, type Node } from 'shoukaku';

import type { BootstrapClient, Dispatcher } from '../../core/index.js';
import BotLog from '../../lib/BotLog.js';
import { DEFAULT_LANGUAGE, translate } from '../../lib/i18n.js';
import { formatDuration } from '../../lib/NodeStatus.js';
import {
    findBestPublicNode,
    isFallbackNode,
    shouldFallback,
    toNodeOption,
} from '../../lib/PublicNodes.js';
import type { BotPlugin } from '../index.js';

const CHECK_INTERVAL_MS = 30_000;
const PROBE_COOLDOWN_MS = 60_000;

/**
 * Keeps Lavalink reachable:
 * - re-adds configured nodes while the primary is down,
 * - moves players that are stranded on a dead node to the serving node,
 * - probes the public list only after the configured outage delay,
 * - removes the public fallback once the primary is healthy and drained.
 */
export class NodeWatchdog {
    private readonly client: BootstrapClient;
    private readonly primaryName: string | undefined;
    private fallbackName: string | null = null;
    private downSince = 0;
    private lastProbeAt = 0;
    private probing = false;
    private migrating = false;
    private announced = false;
    private timer: ReturnType<typeof setInterval> | null = null;

    public constructor(client: BootstrapClient) {
        this.client = client;
        this.primaryName = client.config.lavalink[0]?.name;
    }

    public start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
        this.timer.unref();
    }

    public stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    /** One watchdog pass; public so a test can drive it without timers. */
    public tick(): void {
        if (!this.client.isReady()) return;
        if (this.isPrimaryUp()) {
            this.downSince = 0;
            this.announced = false;
            this.drainFallback();
            return;
        }
        if (this.downSince === 0) this.downSince = Date.now();
        this.dropDeadFallback();
        this.readdConfigured();
        this.migrateStranded();
        if (this.announceStandby()) return;
        this.probePublic();
    }

    /** The connected node that owns `config.lavalink[0]`, if any. */
    private primaryNode(): Node | undefined {
        if (!this.primaryName) return undefined;
        return [...this.client.shoukaku.nodes.values()].find(
            node => node.state === Constants.State.CONNECTED && node.name === this.primaryName
        );
    }

    /** A configured standby must not count as primary recovery. */
    private isPrimaryUp(): boolean {
        return this.primaryNode() !== undefined;
    }

    /** Dispatchers still bound to the public fallback, live or stale. */
    private fallbackPlayers(): Dispatcher[] {
        if (!this.fallbackName) return [];
        const name = this.fallbackName;
        return [...this.client.queue.values()].filter(
            player => player.player.node?.name === name || player.node?.name === name
        );
    }

    /**
     * Primary is healthy again: move local players off the public fallback
     * before removing it. A fallback is shared with other bots, so its remote
     * `stats.players` can never prove that *our* players have drained.
     */
    private drainFallback(): void {
        if (!this.fallbackName) return;
        const target = this.primaryNode();
        if (!target) return;
        // A rebuild destroys the old player before spawning its replacement;
        // removing the node in that window would abort the old player's leave.
        if (this.migrating) return;

        const bound = this.fallbackPlayers();
        for (const player of bound) {
            if (player.current || player.queue.length > 0) continue;
            try {
                player.destroy();
            } catch (error) {
                this.client.logger.debug(`[nodes] could not drop idle fallback player: ${error}`);
            }
        }

        const active = bound.filter(player => player.current || player.queue.length > 0);
        if (active.length === 0) {
            this.dropIdleFallback();
            return;
        }

        const name = this.fallbackName;
        this.migrating = true;
        void this.client.queue
            .migrateFromNode(name, target)
            .then(moved => {
                if (moved > 0) {
                    this.client.logger.info(
                        `[nodes] moved ${moved} player(s) off public fallback "${name}"`
                    );
                }
            })
            .catch(error => this.client.logger.error(`[nodes] fallback migration failed: ${error}`))
            .finally(() => {
                this.migrating = false;
            });
    }

    /** A disconnected fallback would otherwise be retried forever by Shoukaku. */
    private dropDeadFallback(): void {
        if (!this.fallbackName) return;
        const node = this.client.shoukaku.nodes.get(this.fallbackName);
        if (node && node.state !== Constants.State.DISCONNECTED) return;
        if (node) {
            try {
                this.client.shoukaku.removeNode(this.fallbackName, 'fallback disconnected');
            } catch (error) {
                this.client.logger.debug(
                    `[nodes] could not remove fallback ${this.fallbackName}: ${error}`
                );
            }
        }
        this.fallbackName = null;
    }

    private dropIdleFallback(): void {
        if (!this.fallbackName) return;
        const name = this.fallbackName;
        // Remote stats count every bot on a public node, so only our own
        // dispatchers prove the fallback is drained.
        if (this.fallbackPlayers().length > 0) return;
        try {
            this.client.shoukaku.removeNode(name, 'primary restored');
        } catch (error) {
            this.client.logger.error(`[nodes] could not remove fallback ${name}: ${error}`);
            this.fallbackName = null;
            return;
        }
        this.fallbackName = null;
        const message = translate(
            'longtail:events.nodes.fallbackRemoved',
            this.client.config.defaultLanguage ?? DEFAULT_LANGUAGE,
            { name }
        );
        this.client.logger.success(message);
        BotLog.send(this.client, message, 'success');
    }

    private readdConfigured(): void {
        for (const option of this.client.config.lavalink) {
            if (!option.url) continue;
            const existing = this.client.shoukaku.nodes.get(option.name);
            if (existing && existing.state !== Constants.State.DISCONNECTED) continue;
            try {
                if (existing) this.client.shoukaku.removeNode(option.name, 'watchdog');
                this.client.shoukaku.addNode(option);
                this.client.logger.warn(`[nodes] no connected node — re-adding ${option.name}`);
            } catch (error) {
                this.client.logger.error(`[nodes] could not re-add ${option.name}: ${error}`);
            }
        }
    }

    /** Rebuild players bound to a dead node onto whichever node is serving. */
    private migrateStranded(): void {
        if (this.migrating || !this.client.queue.hasNode) return;
        const target = this.client.queue.node;
        if (!target) return;
        const stranded = [...this.client.queue.values()].some(
            dispatcher => dispatcher.isStale || dispatcher.node.name !== target.name
        );
        if (!stranded) return;
        this.migrating = true;
        void this.client.queue
            .migrateToNode(target)
            .catch(error => this.client.logger.error(`[nodes] migration retry failed: ${error}`))
            .finally(() => {
                this.migrating = false;
            });
    }

    /** A configured standby is carrying playback, so no public probe is needed. */
    private announceStandby(): boolean {
        if (!this.client.queue.hasNode) return false;
        const active = this.client.queue.node?.name;
        if (active && !isFallbackNode(active) && !this.announced) {
            const message = translate(
                'longtail:events.nodes.standby',
                this.client.config.defaultLanguage ?? DEFAULT_LANGUAGE,
                { active }
            );
            this.client.logger.warn(message);
            BotLog.send(this.client, message, 'warn');
            this.announced = true;
        }
        return true;
    }

    private probePublic(): void {
        if (this.probing || !this.client.config.nodeFallback) return;
        if (Date.now() - this.lastProbeAt < PROBE_COOLDOWN_MS) return;
        if (
            !shouldFallback(
                Date.now() - this.downSince,
                this.client.config.nodeFallbackAfter,
                this.fallbackName !== null
            )
        ) {
            return;
        }
        this.probing = true;
        this.lastProbeAt = Date.now();
        void this.findFallback();
    }

    private async findFallback(): Promise<void> {
        try {
            const best = await findBestPublicNode(this.client.config.publicNodeListUrl);
            if (!best) {
                this.client.logger.warn('[nodes] no public fallback answered the probe');
                return;
            }
            const option = toNodeOption(best.entry);
            this.client.shoukaku.addNode(option);
            this.fallbackName = option.name;
            const message = translate(
                'longtail:events.nodes.fallbackActive',
                this.client.config.defaultLanguage ?? DEFAULT_LANGUAGE,
                {
                    duration: formatDuration(Date.now() - this.downSince),
                    name: option.name,
                    latency: best.latencyMs,
                    players: best.players,
                }
            );
            this.client.logger.warn(message);
            if (!this.announced) {
                BotLog.send(this.client, message, 'warn');
                this.announced = true;
            }
        } catch (error) {
            this.client.logger.error(`[nodes] public fallback failed: ${error}`);
        } finally {
            this.probing = false;
        }
    }
}

function createPlugin(): BotPlugin {
    let watchdog: NodeWatchdog | null = null;

    return {
        name: 'Node Watchdog',
        version: '1.1.0',
        author: 'Zebz213',
        initialize: (client: BootstrapClient) => {
            if (watchdog) return;
            watchdog = new NodeWatchdog(client);
            watchdog.start();
        },
        shutdown: () => {
            watchdog?.stop();
            watchdog = null;
        },
    };
}

export default createPlugin();
