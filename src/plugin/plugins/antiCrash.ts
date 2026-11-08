import { BootstrapClient } from '../../core/index.js';
import { BotPlugin } from '../index.js';

const antiCrash: BotPlugin = {
    name: 'AntiCrash Plugin',
    version: '1.0.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        process.on('unhandledRejection', (reason, promise) => {
            client.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
        process.on('uncaughtException', err => {
            client.logger.error('Uncaught Exception thrown:', err);
            // Continuing after an uncaught exception means running with unknown
            // state; pm2 restarts a cleaner process than this one.
            process.exit(1);
        });

        const handleExit = async (): Promise<void> => {
            if (client) {
                // Positions are written on a 10s timer; flush them so a restart
                // resumes exactly where playback stopped instead of up to 10s back.
                client.shuttingDown = true;
                client.logger.star('Saving playback state...');
                await Promise.all(
                    [...client.queue.values()].map(dispatcher =>
                        dispatcher.persist().catch(() => {})
                    )
                );
                client.logger.star('Disconnecting from Discord...');
                await client.destroy();
                client.logger.success('Successfully disconnected from Discord!');
                process.exit();
            }
        };
        process.on('SIGINT', handleExit);
        process.on('SIGTERM', handleExit);
        process.on('SIGQUIT', handleExit);
    },
};

export default antiCrash;
