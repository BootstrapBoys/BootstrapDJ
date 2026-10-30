import { Message } from 'discord.js';

import { BootstrapClient } from '../../structures/index.js';
import { BotPlugin } from '../index.js';

const advicePlugin: BotPlugin = {
    name: 'Advice Plugin',
    version: '1.0.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        const adviceList = [
            'Take a break and relax for a bit.',
            'Don\'t be afraid to ask for help.',
            'Try to focus on one task at a time.',
            'Take care of yourself before you take care of others.',
            'Don\'t be too hard on yourself.',
        ];

        client.on('messageCreate', (message: Message) => {
            if (message.content.startsWith('!advice')) {
                const randomIndex = Math.floor(Math.random() * adviceList.length);
                const advice = adviceList[randomIndex];
                message.reply(advice);
            }
        });
    },
};

export default advicePlugin;

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
