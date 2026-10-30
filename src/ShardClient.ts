import { ClientOptions, GatewayIntentBits } from 'discord.js';

import config from './config.js';
import BootstrapClient from './structures/BootstrapClient.js';

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

client.start(config.token);

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
