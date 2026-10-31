import dotenv from 'dotenv';

import { SearchEngine } from './types.js';
import { parseFallbackNodes, toNodeOptions } from './utils/NodeConfig.js';
// quiet: dotenv >=17 prints an 'injected env' banner on every boot.
dotenv.config({ quiet: true });

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
    autoNode: process.env.AUTO_NODE ? parseBoolean(process.env.AUTO_NODE) : true, // auto node: node details are fetched from lavainfo-api (https://lavainfo-api.freedback-dip.workers.dev)
    searchEngine: process.env.SEARCH_ENGINE || SearchEngine.YouTube, // search engine for music
    maxPlaylistSize: process.env.MAX_PLAYLIST_SIZE ? parseInt(process.env.MAX_PLAYLIST_SIZE) : 100, // max playlist size
    botStatus: (process.env.BOT_STATUS || 'online') as 'online' | 'idle' | 'dnd' | 'invisible', // online, idle, dnd, invisible
    botActivity: process.env.BOT_ACTIVITY || 'Bootstrap DJ', // set the bot activity
    botActivityType: process.env.BOT_ACTIVITY_TYPE ? parseInt(process.env.BOT_ACTIVITY_TYPE) : 2, // 0 = PLAYING, 1 = STREAMING, 2 = LISTENING, 3 = WATCHING
    maxQueueSize: process.env.MAX_QUEUE_SIZE ? parseInt(process.env.MAX_QUEUE_SIZE) : 100, // max queue size
    deleteAfter: process.env.COMMAND_DELETE_AFTER ? parseInt(process.env.COMMAND_DELETE_AFTER) : 10, // seconds before a command reply is deleted (0 disables)
    setupCleanupInterval: process.env.SETUP_CLEANUP_INTERVAL ? parseInt(process.env.SETUP_CLEANUP_INTERVAL) : 30, // seconds between song-request channel sweeps (0 disables)
    autoplaySeed: process.env.AUTOPLAY_SEED || 'top hits', // search term autoplay uses when nothing has played yet
    sessionRestoreAge: process.env.SESSION_RESTORE_AGE ? parseInt(process.env.SESSION_RESTORE_AGE) : 21600, // seconds a saved queue stays restorable (0 disables)
    nodeFallback: process.env.NODE_FALLBACK ? parseBoolean(process.env.NODE_FALLBACK) : true, // use a probed public node when the primary is down
    nodeFallbackAfter: process.env.NODE_FALLBACK_AFTER ? parseInt(process.env.NODE_FALLBACK_AFTER) : 180, // seconds of continuous outage before falling back
    publicNodeListUrl:
        process.env.PUBLIC_NODE_LIST_URL || 'https://lavalink-list.ajieblogs.eu.org/All', // public node list API
    nodeAlertReminderMinutes: process.env.NODE_ALERT_REMINDER_MINUTES
        ? parseInt(process.env.NODE_ALERT_REMINDER_MINUTES)
        : 15, // minutes between 'still down' notices during a node outage (0 disables)
    sessionEmptyWait: process.env.SESSION_EMPTY_WAIT ? parseInt(process.env.SESSION_EMPTY_WAIT) : 30, // seconds to wait for a listener before discarding the queue (0 = no wait)
    owners: (process.env.OWNER_IDS ? JSON.parse(process.env.OWNER_IDS) : []) as string[], // bot owners
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
    } as Record<string, string>, // music icons
    production: process.env.PRODUCTION ? parseBoolean(process.env.PRODUCTION) : true,
    lavalink: toNodeOptions(
        {
            name: process.env.LAVALINK_NAME || 'Bootstrap Node',
            url: (process.env.LAVALINK_URL ?? '').trim(),
            auth: process.env.LAVALINK_AUTH ?? '',
            secure: process.env.LAVALINK_SECURE ? parseBoolean(process.env.LAVALINK_SECURE) : false,
        },
        parseFallbackNodes(process.env.LAVALINK_FALLBACKS)
    ), // primary node followed by LAVALINK_FALLBACKS, in order
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
