import dotenv from 'dotenv';

import { parseFallbackNodes, toNodeOptions } from './lib/NodeConfig.js';
import { SearchEngine } from './types.js';

dotenv.config({ quiet: true });

const env = process.env;

const text = (key: string, fallback: string = ''): string => env[key] || fallback;

/** `parseInt` with a fallback; malformed values keep the fallback. */
function integer(key: string, fallback: number): number {
    const value = env[key];
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

/** Only an explicit `true` enables a flag; anything else is false. */
function flag(key: string, fallback: boolean): boolean {
    const value = env[key];
    if (value === undefined) return fallback;
    return value.trim().toLowerCase() === 'true';
}

function list(key: string): string[] {
    return (env[key] ?? '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
}

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * `OWNER_IDS` is a JSON array of Discord snowflake strings.
 *
 * A malformed value must stop startup instead of leaving the developer gate
 * open: `JSON.parse` used to be cast to `string[]`, so `null`, a JSON string or
 * comma-separated ids either crashed a command or turned `.includes()` into a
 * substring match. Throwing here is the fail-closed path.
 */
export function parseOwnerIds(raw: string | undefined): string[] {
    if (!raw || !raw.trim()) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(
            'OWNER_IDS must be a JSON array of Discord snowflake strings, for example ["123456789012345678"]'
        );
    }
    if (!Array.isArray(parsed)) {
        throw new Error(
            'OWNER_IDS must be a JSON array of Discord snowflake strings, for example ["123456789012345678"]'
        );
    }
    const owners: string[] = [];
    for (const [index, value] of parsed.entries()) {
        if (typeof value !== 'string' || !SNOWFLAKE.test(value.trim())) {
            throw new Error(
                `OWNER_IDS entry ${index} is not a Discord snowflake string (17-20 digits)`
            );
        }
        const id = value.trim();
        if (!owners.includes(id)) owners.push(id);
    }
    return owners;
}

const PALETTE = {
    red: 0xff0000,
    green: 0x00ff00,
    blue: 0x0000ff,
    yellow: 0xffff00,
    main: 0x2f3136,
};

const SOURCE_ICONS: Record<string, string> = {
    youtube: 'https://i.imgur.com/xzVHhFY.png',
    spotify: 'https://i.imgur.com/qvdqtsc.png',
    soundcloud: 'https://i.imgur.com/MVnJ7mj.png',
    applemusic: 'https://i.imgur.com/Wi0oyYm.png',
    deezer: 'https://i.imgur.com/xyZ43FG.png',
};

function statusMode(): 'static' | 'track' | 'count' {
    const value = env.BOT_STATUS_MODE;
    return value === 'track' || value === 'count' ? value : 'static';
}

const config = {
    token: env.BOT_TOKEN || env.DISCORD_TOKEN || env.TOKEN || '',
    botsFile: text('BOTS_FILE'),
    botId: text('BOT_ID'),
    botName: text('BOT_NAME'),
    botPriority: integer('BOT_PRIORITY', -1),
    botCoordinator: flag('BOT_COORDINATOR', false),
    shardCount: integer('SHARD_COUNT', 0),
    prefix: text('PREFIX', '!'),
    color: PALETTE,
    autoNode: flag('AUTO_NODE', true),
    searchEngine: text('SEARCH_ENGINE', SearchEngine.YouTube),
    prefixSearchEngine: text('PREFIX_SEARCH_ENGINE', SearchEngine.YouTube),
    maxPlaylistSize: integer('MAX_PLAYLIST_SIZE', 100),
    botStatus: text('BOT_STATUS', 'online') as 'online' | 'idle' | 'dnd' | 'invisible',
    botActivity: text('BOT_ACTIVITY', 'Bootstrap DJ'),
    botActivityType: integer('BOT_ACTIVITY_TYPE', 2),
    botStatusMode: statusMode(),
    maxQueueSize: integer('MAX_QUEUE_SIZE', 100),
    deleteAfter: integer('COMMAND_DELETE_AFTER', 10),
    setupCleanupInterval: integer('SETUP_CLEANUP_INTERVAL', 30),
    autoplaySeed: text('AUTOPLAY_SEED', 'dj'),
    autoplayChart: flag('AUTOPLAY_CHART', true),
    autoplaySeeds: list('AUTOPLAY_SEEDS'),
    sessionRestoreAge: integer('SESSION_RESTORE_AGE', 21600),
    nodeFallback: flag('NODE_FALLBACK', true),
    nodeFallbackAfter: integer('NODE_FALLBACK_AFTER', 180),
    publicNodeListUrl: text('PUBLIC_NODE_LIST_URL', 'https://lavalink-list.ajieblogs.eu.org/All'),
    nodeAlertReminderMinutes: integer('NODE_ALERT_REMINDER_MINUTES', 15),
    sessionEmptyWait: integer('SESSION_EMPTY_WAIT', 30),
    statsRetentionDays: integer('STATS_RETENTION_DAYS', 90),
    statsInactiveDays: integer('STATS_INACTIVE_DAYS', 180),
    statsPruneIntervalHours: integer('STATS_PRUNE_INTERVAL_HOURS', 24),
    owners: parseOwnerIds(env.OWNER_IDS),
    clientId: text('CLIENT_ID'),
    guildId: text('GUILD_ID'),
    logChannelId: text('LOG_CHANNEL_ID'),
    dashboardPort: integer('DASHBOARD_PORT', 0),
    dashboardHost: text('DASHBOARD_HOST', '127.0.0.1'),
    dashboardPublicUrl: text('DASHBOARD_PUBLIC_URL'),
    dashboardToken: text('DASHBOARD_TOKEN'),
    dashboardAllowAnonymous: flag('DASHBOARD_ALLOW_ANONYMOUS', false),
    dashboardOAuthClientId: text('DASHBOARD_OAUTH_CLIENT_ID', text('CLIENT_ID')),
    dashboardOAuthClientSecret: text('DASHBOARD_OAUTH_CLIENT_SECRET'),
    dashboardOAuthRedirectUri: text('DASHBOARD_OAUTH_REDIRECT_URI'),
    dashboardSessionSecret: text('DASHBOARD_SESSION_SECRET'),
    dashboardMode: text('DASHBOARD_MODE', 'embedded'),
    dashboardControlPort: integer('DASHBOARD_CONTROL_PORT', 8796),
    dashboardControlSecret: text('DASHBOARD_CONTROL_SECRET'),
    dashboardTapUrl: text('DASHBOARD_TAP_URL'),
    dashboardTapToken: text('DASHBOARD_TAP_TOKEN'),
    dashboardVoiceChannelId: text('DASHBOARD_VOICE_CHANNEL_ID'),
    earlControlUrl: text('EARL_CONTROL_URL', 'http://127.0.0.1:8791'),
    earlBridgeSecret: text('EARL_BRIDGE_SECRET'),
    voiceBridgePort: integer('VOICE_BRIDGE_PORT', 8790),
    earlLiveBadgeUrl: text('EARL_LIVE_BADGE_URL'),
    links: {
        img: text('IMG_LINK', 'https://i.imgur.com/ud3EWNh.jpg'),
    },
    icons: SOURCE_ICONS,
    production: flag('PRODUCTION', true),
    lavalink: toNodeOptions(
        {
            name: text('LAVALINK_NAME', 'Bootstrap Node'),
            url: (env.LAVALINK_URL ?? '').trim(),
            auth: env.LAVALINK_AUTH ?? '',
            secure: flag('LAVALINK_SECURE', false),
        },
        parseFallbackNodes(env.LAVALINK_FALLBACKS)
    ),
};

export default config;
