import { Events } from 'discord.js';

import type { BootstrapClient } from '../../core/index.js';
import type { BotPlugin } from '../index.js';

/** Publish the configured presence once the client can report a user. */
const updateStatusPlugin: BotPlugin = {
    name: 'Update Status Plugin',
    version: '1.0.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        client.once(Events.ClientReady, () => {
            client.utils.updateStatus(client);
        });
    },
};

export default updateStatusPlugin;
