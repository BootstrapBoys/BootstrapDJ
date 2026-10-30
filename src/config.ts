import dotenv from 'dotenv';

import { SearchEngine } from './types.js';
dotenv.config();

export default {
    token: process.env.TOKEN ?? '',
    prefix: process.env.PREFIX || '!',
    color: {
        red: 0xff0000,
        green: 0x00ff00,
        blue: 0x0000ff,
        yellow: 0xffff00,
        main: 0x2f3136,
    },
    autoNode: process.env.AUTO_NODE ? parseBoolean(process.env.AUTO_NODE) : true, // auto node for lavamusic bot it is gave from lavainfo-api "https://lavainfo-api.freedback-dip.workers.dev"
    searchEngine: process.env.SEARCH_ENGINE || SearchEngine.YouTube, // search engine for music
    maxPlaylistSize: process.env.MAX_PLAYLIST_SIZE ? parseInt(process.env.MAX_PLAYLIST_SIZE) : 100, // max playlist size
    botStatus: process.env.BOT_STATUS || 'online', // online, idle, dnd, invisible
    botActivity: process.env.BOT_ACTIVITY || 'BootstrapDJ', // set the bot activity
    botActivityType: process.env.BOT_ACTIVITY_TYPE ? parseInt(process.env.BOT_ACTIVITY_TYPE) : 2, // 0 = PLAYING, 1 = STREAMING, 2 = LISTENING, 3 = WATCHING
    maxQueueSize: process.env.MAX_QUEUE_SIZE ? parseInt(process.env.MAX_QUEUE_SIZE) : 100, // max queue size
    deleteAfter: process.env.COMMAND_DELETE_AFTER ? parseInt(process.env.COMMAND_DELETE_AFTER) : 10, // seconds before a command reply is deleted (0 disables)
    setupCleanupInterval: process.env.SETUP_CLEANUP_INTERVAL ? parseInt(process.env.SETUP_CLEANUP_INTERVAL) : 30, // seconds between song-request channel sweeps (0 disables)
    autoplaySeed: process.env.AUTOPLAY_SEED || 'top hits', // search term autoplay uses when nothing has played yet
    sessionRestoreAge: process.env.SESSION_RESTORE_AGE ? parseInt(process.env.SESSION_RESTORE_AGE) : 21600, // seconds a saved queue stays restorable (0 disables)
    owners: process.env.OWNER_IDS ? JSON.parse(process.env.OWNER_IDS) : [], // bot owners
    clientId: process.env.CLIENT_ID ?? '', // bot client id
    guildId: process.env.GUILD_ID ?? '', // guild id
    logChannelId: process.env.LOG_CHANNEL_ID || '', // log channel id
    links: {
        img: process.env.IMG_LINK || 'https://i.imgur.com/ud3EWNh.jpg',
    }, // image links
    icons: {
        youtube: 'https://i.imgur.com/xzVHhFY.png',
        spotify: 'https://i.imgur.com/qvdqtsc.png',
        soundcloud: 'https://i.imgur.com/MVnJ7mj.png',
        applemusic: 'https://i.imgur.com/Wi0oyYm.png',
        deezer: 'https://i.imgur.com/xyZ43FG.png',
    }, // music icons
    production: process.env.PRODUCTION ? parseBoolean(process.env.PRODUCTION) : true,
    lavalink: [
        {
            url: process.env.LAVALINK_URL ?? '',
            auth: process.env.LAVALINK_AUTH ?? '',
            name: process.env.LAVALINK_NAME || 'Bootstrap Node',
            secure: process.env.LAVALINK_SECURE ? parseBoolean(process.env.LAVALINK_SECURE) : false,
        },
    ], // lavalink nodes
};

function parseBoolean(value: string | undefined): boolean {
    if (typeof value === 'string') {
        value = value.trim().toLowerCase();
    }
    switch (value) {
        case 'true':
            return true;
        default:
            return false;
    }
}
/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
