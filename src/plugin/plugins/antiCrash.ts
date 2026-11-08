import type { BootstrapClient } from '../../core/index.js';
import { shutdownPlugins } from '../index.js';
import type { BotPlugin } from '../index.js';

const SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

/**
 * Process-level safety net:
 * - a rejected promise is logged and the bot keeps serving,
 * - an uncaught exception is logged and the process exits so a supervisor can
 *   restart it from the persisted session,
 * - a termination signal drains playback snapshots before disconnecting.
 */
function createPlugin(): BotPlugin {
    let installed = false;
    let removeHandlers: (() => void) | null = null;

    return {
        name: 'AntiCrash Plugin',
        version: '1.0.0',
        author: 'Zebz213',
        initialize: (client: BootstrapClient) => {
            if (installed) return;
            installed = true;

            let draining = false;

            const onRejection = (reason: unknown, promise: Promise<unknown>): void => {
                client.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            };
            const onException = (error: Error): void => {
                client.logger.error('Uncaught Exception thrown:', error);
                process.exit(1);
            };

            const drain = async (): Promise<void> => {
                if (draining) return;
                draining = true;
                client.shuttingDown = true;
                client.logger.star('Saving playback state...');
                const players = [...client.queue.values()];
                await Promise.all(players.map(player => player.persist().catch(() => {})));
                client.logger.star('Stopping plugins...');
                await shutdownPlugins(client);
                client.logger.star('Disconnecting from Discord...');
                try {
                    await client.destroy();
                    client.logger.success('Successfully disconnected from Discord!');
                } catch (error) {
                    client.logger.error('Failed to disconnect from Discord:', error);
                }
                process.exit(0);
            };

            const onSignal = (): void => {
                void drain();
            };

            process.on('unhandledRejection', onRejection);
            process.on('uncaughtException', onException);
            for (const signal of SIGNALS) process.on(signal, onSignal);

            removeHandlers = () => {
                process.off('unhandledRejection', onRejection);
                process.off('uncaughtException', onException);
                for (const signal of SIGNALS) process.off(signal, onSignal);
            };
        },
        shutdown: () => {
            removeHandlers?.();
            removeHandlers = null;
            installed = false;
        },
    };
}

export default createPlugin();
