import { Events } from 'discord.js';

import { BootstrapClient } from '../../core/index.js';
import { BotPlugin } from '../index.js';

const updateStatusPlugin: BotPlugin = {
    name: 'Update Status Plugin',
    version: '1.0.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        client.on(Events.ClientReady, () => {
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
