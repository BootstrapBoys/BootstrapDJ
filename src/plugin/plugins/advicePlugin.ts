import { Events, type Message } from 'discord.js';

import type { BootstrapClient } from '../../core/index.js';
import type { BotPlugin } from '../index.js';

const ADVICE: readonly string[] = [
    'Take a break and relax for a bit.',
    "Don't be afraid to ask for help.",
    'Try to focus on one task at a time.',
    'Take care of yourself before you take care of others.',
    "Don't be too hard on yourself.",
];

/** A message triggers when it begins with any configured prefix + "advice". */
function isAdviceRequest(message: Message, prefixes: string[]): boolean {
    if (message.author.bot) return false;
    return prefixes.some(prefix => message.content.startsWith(`${prefix}advice`));
}

function pickAdvice(): string {
    return ADVICE[Math.floor(Math.random() * ADVICE.length)];
}

const advicePlugin: BotPlugin = {
    name: 'Advice Plugin',
    version: '1.0.0',
    author: 'Zebz213',
    initialize: (client: BootstrapClient) => {
        const prefixes = client.config.prefix
            .split(',')
            .map(prefix => prefix.trim())
            .filter(Boolean);

        client.on(Events.MessageCreate, (message: Message) => {
            if (!client.user || !isAdviceRequest(message, prefixes)) return;
            void message.reply(pickAdvice()).catch(error => {
                client.logger.debug(`[advice] reply failed: ${error}`);
            });
        });
    },
};

export default advicePlugin;
