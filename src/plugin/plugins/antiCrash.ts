import { BootstrapClient } from '../../core/index.js';
import { BotPlugin } from '../index.js';

let shuttingDown = false;

const antiCrash: BotPlugin = {
    name: 'AntiCrash Plugin',
    version: '1.0.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        process.on('unhandledRejection', (reason, promise) => {
            client.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
        process.on('uncaughtException', error => {
            client.logger.error('Uncaught Exception thrown:', error);
            process.exit(1);
        });

        const shutdown = async (): Promise<void> => {
            if (shuttingDown) return;
            shuttingDown = true;
            client.shuttingDown = true;
            client.logger.star('Saving playback state...');
            await Promise.all(
                Array.from(client.queue.values()).map(dispatcher =>
                    dispatcher.persist().catch(() => {})
                )
            );
            client.logger.star('Disconnecting from Discord...');
            await client.destroy();
            client.logger.success('Successfully disconnected from Discord!');
            process.exit();
        };

        for (const signal of ['SIGINT', 'SIGTERM', 'SIGQUIT'] as const) {
            process.on(signal, shutdown);
        }
    },
};

export default antiCrash;
