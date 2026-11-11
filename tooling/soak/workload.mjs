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
    let targets;
    if (env.SOAK_TARGETS) {
        try {
            targets = JSON.parse(env.SOAK_TARGETS);
        } catch {
            throw new Error('SOAK_TARGETS must be a JSON array');
        }
        if (!Array.isArray(targets) || !targets.length) {
            throw new Error('SOAK_TARGETS must be a non-empty JSON array');
        }
        targets = targets.map((target, index) => {
            if (
                !target ||
                typeof target !== 'object' ||
                !target.guildId ||
                !target.voiceChannelId
            ) {
                throw new Error(`SOAK_TARGETS[${index}] requires guildId and voiceChannelId`);
            }
            return {
                guildId: String(target.guildId),
                voiceChannelId: String(target.voiceChannelId),
                textChannelId: target.textChannelId ? String(target.textChannelId) : undefined,
            };
        });
    } else {
        const required = ['SOAK_GUILD_ID', 'SOAK_VOICE_CHANNEL_ID'];
        const missing = required.filter(key => !env[key]);
        if (missing.length) throw new Error(`missing soak workload env: ${missing.join(', ')}`);
        targets = [
            {
                guildId: env.SOAK_GUILD_ID,
                voiceChannelId: env.SOAK_VOICE_CHANNEL_ID,
                textChannelId: env.SOAK_TEXT_CHANNEL_ID,
            },
        ];
    }
    if (!env.SOAK_USER_ID) throw new Error('missing soak workload env: SOAK_USER_ID');
    const first = targets[0];
    return {
        bridgeUrl: env.SOAK_BRIDGE_URL ?? 'http://127.0.0.1:8792/voice/command',
        secret: env.SOAK_BRIDGE_SECRET ?? env.EARL_BRIDGE_SECRET ?? '',
        guildId: first.guildId,
        voiceChannelId: first.voiceChannelId,
        textChannelId: first.textChannelId,
        userId: env.SOAK_USER_ID,
        targets,
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
    const target =
        config.targets && config.targets.length
            ? config.targets[step % config.targets.length]
            : config;
    const action = ACTIONS[step % ACTIONS.length];
    const query =
        action === 'play' || action === 'playnext' ? ` ${QUERIES[step % QUERIES.length]}` : '';
    const text = `${action}${query}`.trim();
    try {
        const result = await bridgeCommand({ ...config, ...target }, text);
        return { text, guildId: target.guildId, ok: true, result };
    } catch (error) {
        return {
            text,
            guildId: target.guildId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
