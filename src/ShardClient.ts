import { ClientOptions, GatewayIntentBits } from 'discord.js';

import config from './config.js';
import BootstrapClient from './core/BootstrapClient.js';
import { startClientOrExit } from './lib/Startup.js';

const {
    GuildMembers,
    MessageContent,
    GuildVoiceStates,
    GuildMessages,
    Guilds,
    GuildMessageTyping,
} = GatewayIntentBits;
const clientOptions: ClientOptions = {
    intents: [
        Guilds,
        GuildMessages,
        MessageContent,
        GuildVoiceStates,
        GuildMembers,
        GuildMessageTyping,
    ],
    allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: false,
    },
};

const client = new BootstrapClient(clientOptions);

void startClientOrExit(client, process.env.BOT_TOKEN || config.token);

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
