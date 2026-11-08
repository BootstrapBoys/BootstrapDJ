import { fetchJson } from './metrics.mjs';

const QUERIES = [
    'nf fear',
    'nf let you down',
    'parker jack selftalk',
    'the search nf',
    'clouds nf',
];

const ACTIONS = [
    'play',
    'play',
    'playnext',
    'skip',
    'pause',
    'resume',
    'volume 25',
    'volume 80',
    'queue',
    'np',
    'autoplay on',
    'autoplay off',
    'skip',
    'play',
];

export function workloadConfig(env = process.env) {
    const required = ['SOAK_GUILD_ID', 'SOAK_VOICE_CHANNEL_ID', 'SOAK_USER_ID'];
    const missing = required.filter(key => !env[key]);
    if (missing.length) throw new Error(`missing soak workload env: ${missing.join(', ')}`);
    return {
        bridgeUrl: env.SOAK_BRIDGE_URL ?? 'http://127.0.0.1:8792/voice/command',
        secret: env.SOAK_BRIDGE_SECRET ?? env.EARL_BRIDGE_SECRET ?? '',
        guildId: env.SOAK_GUILD_ID,
        voiceChannelId: env.SOAK_VOICE_CHANNEL_ID,
        textChannelId: env.SOAK_TEXT_CHANNEL_ID,
        userId: env.SOAK_USER_ID,
    };
}

export async function bridgeCommand(config, text, timeoutMs = 8000) {
    if (!config.secret) throw new Error('SOAK_BRIDGE_SECRET/EARL_BRIDGE_SECRET is required');
    const body = {
        guildId: config.guildId,
        voiceChannelId: config.voiceChannelId,
        userId: config.userId,
        textChannelId: config.textChannelId,
        text,
    };
    return await fetchJson(
        config.bridgeUrl,
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${config.secret}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
        },
        timeoutMs
    );
}

/** One bounded workload step. Errors are returned so the orchestrator can log them. */
export async function workloadStep(config, step) {
    const action = ACTIONS[step % ACTIONS.length];
    const query =
        action === 'play' || action === 'playnext' ? ` ${QUERIES[step % QUERIES.length]}` : '';
    const text = `${action}${query}`.trim();
    try {
        const result = await bridgeCommand(config, text);
        return { text, ok: true, result };
    } catch (error) {
        return { text, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
