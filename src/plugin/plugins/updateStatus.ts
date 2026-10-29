import { Lavamusic } from '../../structures/index.js';
import { BotPlugin } from '../index.js';

const updateStatusPlugin: BotPlugin = {
    name: 'Update Status Plugin',
    version: '1.0.0',
    author: 'Zebz213',
    initialize: (client: Lavamusic) => {
        client.on('ready', () => {
            client.utils.updateStatus(client);
        });
    },
};

export default updateStatusPlugin;

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
