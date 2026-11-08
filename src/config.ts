import dotenv from 'dotenv';

import { parseFallbackNodes, toNodeOptions } from './lib/NodeConfig.js';
import { SearchEngine } from './types.js';

dotenv.config({ quiet: true });

const raw = process.env;

function text(name: string, fallback: string = ''): string {
    return raw[name] || fallback;
}

function integer(name: string, fallback: number): number {
    const value = raw[name];
    return value ? Number.parseInt(value, 10) : fallback;
}

function flag(name: string, fallback: boolean): boolean {
    const value = raw[name];
    if (value === undefined) return fallback;
    return value.trim().toLowerCase() === 'true';
}

function commaList(name: string): string[] {
    return (raw[name] ?? '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
}

const statusMode = ((): 'static' | 'track' | 'count' => {
    const value = raw.BOT_STATUS_MODE;
    return value === 'track' || value === 'count' ? value : 'static';
})();

const config = {
    token: raw.BOT_TOKEN || raw.DISCORD_TOKEN || raw.TOKEN || '',
    botsFile: text('BOTS_FILE'),
    botId: text('BOT_ID'),
    botName: text('BOT_NAME'),
    botPriority: raw.BOT_PRIORITY ? integer('BOT_PRIORITY', -1) : -1,
    botCoordinator: flag('BOT_COORDINATOR', false),
    shardCount: raw.SHARD_COUNT ? integer('SHARD_COUNT', 0) : 0,
    prefix: text('PREFIX', '!'),
    color: {
        red: 0xff0000,
        green: 0x00ff00,
        blue: 0x0000ff,
        yellow: 0xffff00,
        main: 0x2f3136,
    },
    autoNode: flag('AUTO_NODE', true),
    searchEngine: text('SEARCH_ENGINE', SearchEngine.YouTube),
    prefixSearchEngine: text('PREFIX_SEARCH_ENGINE', SearchEngine.YouTube),
    maxPlaylistSize: integer('MAX_PLAYLIST_SIZE', 100),
    botStatus: text('BOT_STATUS', 'online') as 'online' | 'idle' | 'dnd' | 'invisible',
    botActivity: text('BOT_ACTIVITY', 'Bootstrap DJ'),
    botActivityType: integer('BOT_ACTIVITY_TYPE', 2),
    botStatusMode: statusMode,
    maxQueueSize: integer('MAX_QUEUE_SIZE', 100),
    deleteAfter: integer('COMMAND_DELETE_AFTER', 10),
    setupCleanupInterval: integer('SETUP_CLEANUP_INTERVAL', 30),
    autoplaySeed: text('AUTOPLAY_SEED', 'dj'),
    autoplayChart: flag('AUTOPLAY_CHART', true),
    autoplaySeeds: commaList('AUTOPLAY_SEEDS'),
    sessionRestoreAge: integer('SESSION_RESTORE_AGE', 21600),
    nodeFallback: flag('NODE_FALLBACK', true),
    nodeFallbackAfter: integer('NODE_FALLBACK_AFTER', 180),
    publicNodeListUrl: text('PUBLIC_NODE_LIST_URL', 'https://lavalink-list.ajieblogs.eu.org/All'),
    nodeAlertReminderMinutes: integer('NODE_ALERT_REMINDER_MINUTES', 15),
    sessionEmptyWait: integer('SESSION_EMPTY_WAIT', 30),
    statsRetentionDays: integer('STATS_RETENTION_DAYS', 90),
    statsInactiveDays: integer('STATS_INACTIVE_DAYS', 180),
    statsPruneIntervalHours: integer('STATS_PRUNE_INTERVAL_HOURS', 24),
    owners: (raw.OWNER_IDS ? JSON.parse(raw.OWNER_IDS) : []) as string[],
    clientId: text('CLIENT_ID'),
    guildId: text('GUILD_ID'),
    logChannelId: text('LOG_CHANNEL_ID'),
    dashboardPort: integer('DASHBOARD_PORT', 0),
    dashboardHost: text('DASHBOARD_HOST', '127.0.0.1'),
    dashboardPublicUrl: text('DASHBOARD_PUBLIC_URL'),
    dashboardToken: text('DASHBOARD_TOKEN'),
    dashboardOAuthClientId: text('DASHBOARD_OAUTH_CLIENT_ID', text('CLIENT_ID')),
    dashboardOAuthClientSecret: text('DASHBOARD_OAUTH_CLIENT_SECRET'),
    dashboardOAuthRedirectUri: text('DASHBOARD_OAUTH_REDIRECT_URI'),
    dashboardSessionSecret: text('DASHBOARD_SESSION_SECRET'),
    earlControlUrl: text('EARL_CONTROL_URL', 'http://127.0.0.1:8791'),
    earlBridgeSecret: text('EARL_BRIDGE_SECRET'),
    voiceBridgePort: integer('VOICE_BRIDGE_PORT', 8790),
    earlLiveBadgeUrl: text('EARL_LIVE_BADGE_URL'),
    links: {
        img: text('IMG_LINK', 'https://i.imgur.com/ud3EWNh.jpg'),
    },
    icons: {
        youtube: 'https://i.imgur.com/xzVHhFY.png',
        spotify: 'https://i.imgur.com/qvdqtsc.png',
        soundcloud: 'https://i.imgur.com/MVnJ7mj.png',
        applemusic: 'https://i.imgur.com/Wi0oyYm.png',
        deezer: 'https://i.imgur.com/xyZ43FG.png',
    } as Record<string, string>,
    production: flag('PRODUCTION', true),
    lavalink: toNodeOptions(
        {
            name: text('LAVALINK_NAME', 'Bootstrap Node'),
            url: (raw.LAVALINK_URL ?? '').trim(),
            auth: raw.LAVALINK_AUTH ?? '',
            secure: flag('LAVALINK_SECURE', false),
        },
        parseFallbackNodes(raw.LAVALINK_FALLBACKS)
    ),
};

export default config;
