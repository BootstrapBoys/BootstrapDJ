import type { EarlCommandBody, EarlCommandResult } from '../../types.js';
import { ChannelType, Events, Guild, GuildMember, PermissionFlagsBits, TextChannel } from 'discord.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Dispatcher } from '../../core/index.js';
import { updateSetup } from '../../lib/SetupSystem.js';
import { hasDjAccess, isVoiceOptedOut } from '../../lib/VoiceAccess.js';
import { BotPlugin } from '../index.js';

type VoiceCommandBody = EarlCommandBody;

/** Commands Earl may run. Everything else is a no-op, so a misheard word cannot
 * reach destructive commands. */
const ACTIONS = new Set(['play', 'playnext', 'skip', 'pause', 'resume', 'stop', 'queue', 'np', 'volume', 'autoplay']);

/** Speech-to-text reliably turns short words into homophones ("queue" -> "Q",
 * "next" -> "nex"), so map the likely spellings onto the real verbs. */
const ALIASES: Record<string, string> = {
    q: 'queue',
    que: 'queue',
    cue: 'queue',
    cueue: 'queue',
    'queue up': 'queue',
    next: 'skip',
    nex: 'skip',
    skip: 'skip',
    nowplaying: 'np',
    whats: 'np',
    'now playing': 'np',
    pause: 'pause',
    unpause: 'resume',
    continue: 'resume',
    resume: 'resume',
    stop: 'stop',
    play: 'play',
    playnext: 'playnext',
    volume: 'volume',
};

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 100_000) {
                reject(new Error('body too large'));
                req.destroy();
            }
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

/** Identical voice commands can arrive twice when two capture streams overlap;
 * ignore a repeat from the same member within a few seconds. */
const recentCommands = new Map<string, number>();

function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/** Run a voice command locally in a single-process/BOTS_FILE deployment, or
 * on the shard that owns the guild when ShardingManager is active. */
async function executeVoice(
    client: BootstrapClient,
    body: VoiceCommandBody
): Promise<EarlCommandResult> {
    if (!client.shard) {
        if (!client.earlCommand) return { status: 503, message: 'The bot is still starting up.' };
        return await client.earlCommand(body);
    }
    const results = await client.shard.broadcastEval(
        async (shard, context) => {
            const candidate = shard as unknown as BootstrapClient;
            const guildId = context.body.guildId ?? '';
            if (!guildId || !candidate.guilds.cache.has(guildId)) return null;
            return candidate.earlCommand ? await candidate.earlCommand(context.body) : null;
        },
        { context: { body } }
    );
    return results.find((result): result is EarlCommandResult => result !== null) ?? {
        status: 503,
        message: 'The bot is still starting up.',
    };
}

async function refreshSetup(client: BootstrapClient, guildId: string): Promise<void> {
    if (!client.shard) {
        await client.earlRefreshSetup?.(guildId);
        return;
    }
    await client.shard.broadcastEval(
        async (shard, context) => {
            const candidate = shard as unknown as BootstrapClient;
            if (!candidate.guilds.cache.has(context.guildId)) return false;
            await candidate.earlRefreshSetup?.(context.guildId);
            return true;
        },
        { context: { guildId } }
    );
}

function createPlugin(): BotPlugin {
        let server: ReturnType<typeof createServer> | null = null;

        return {
            name: 'Earl Bridge',
            version: '1.0.0',
            author: 'Zebz213',
            initialize: (client: BootstrapClient) => {
                const secret = client.config.earlBridgeSecret;
                if (!secret) {
                    client.logger.warn('[earl] EARL_BRIDGE_SECRET is empty — voice bridge disabled');
                    return;
                }

                client.earlCommand = async body => {
                    const result = await handle(client, body);
                    if (result.message) await say(client, body, result.message);
                    return result;
                };
                client.earlRefreshSetup = async guildId => {
                    const guild = client.guilds.cache.get(guildId);
                    if (guild) await updateSetup(client, guild).catch(() => {});
                };

                // In a sharded deployment only shard 0 binds the public bridge;
                // the other shards expose earlCommand through broadcastEval.
                // BOTS_FILE uses one process per account, each with its own port.
                if (client.shard && !client.isCoordinator) return;

                server = createServer(async (req, res) => {
                    const url = new URL(req.url ?? '/', 'http://localhost');
                    if (req.headers.authorization !== `Bearer ${secret}`) {
                        return send(res, 401, { error: 'unauthorized' });
                    }
                    if (req.method === 'POST' && url.pathname === '/voice/listener-stopped') {
                        try {
                            const raw = await readBody(req);
                            const body = JSON.parse(raw || '{}') as { guildId?: string };
                            if (body.guildId) {
                                await client.db.setVoiceListen(body.guildId, { enabled: false });
                                await refreshSetup(client, body.guildId);
                            }
                            return send(res, 200, { ok: true });
                        } catch (error) {
                            return send(res, 400, { error: String(error) });
                        }
                    }
                    if (req.method === 'GET' && url.pathname === '/voice/optouts') {
                        const guildId = url.searchParams.get('guildId') ?? '';
                        const rows = guildId ? await client.db.listVoiceOptOuts(guildId) : [];
                        return send(res, 200, { userIds: rows.map(row => row.userId) });
                    }
                    if (req.method !== 'POST' || url.pathname !== '/voice/command') {
                        return send(res, 404, { error: 'not found' });
                    }
                    try {
                        const raw = await readBody(req);
                        const body = JSON.parse(raw || '{}') as VoiceCommandBody;
                        const result = await executeVoice(client, body);
                        return send(res, result.status, { ok: result.status < 400, message: result.message });
                    } catch (error) {
                        client.logger.error(`[earl] bridge error: ${error}`);
                        return send(res, 500, { error: 'internal error' });
                    }
                });

                server.listen(client.config.voiceBridgePort, '127.0.0.1', () => {
                    client.logger.info(`[earl] voice bridge on 127.0.0.1:${client.config.voiceBridgePort}`);
                });

                // The listener can stop without telling us (crash/restart). Once
                // the bot is up, clear a stale enabled flag if it is not running.
                if (!client.shard || client.isCoordinator) client.once(Events.ClientReady, () => {
                    setTimeout(() => {
                        void (async () => {
                            try {
                                const response = await fetch(`${client.config.earlControlUrl}/status`, {
                                    headers: { authorization: `Bearer ${secret}` },
                                    signal: AbortSignal.timeout(5_000),
                                });
                                if (!response.ok) return;
                                const status = (await response.json()) as { active?: boolean };
                                if (status.active) return;
                                const guildId = client.config.guildId || client.guilds.cache.first()?.id;
                                if (!guildId) return;
                                const state = await client.db.getVoiceListen(guildId);
                                if (!state?.enabled) return;
                                await client.db.setVoiceListen(guildId, { enabled: false });
                                await refreshSetup(client, guildId);
                                client.logger.warn('[earl] listener was not active; cleared stale listening state');
                            } catch {
                                // Listener may still be starting; leave the state alone.
                            }
                        })();
                    }, 15_000);
                });

            },
            shutdown: () => {
                server?.close();
                server = null;
            },
        };
}

async function handle(
    client: BootstrapClient,
    body: VoiceCommandBody
): Promise<{ status: number; message: string }> {
    if (!client.isReady()) return { status: 503, message: 'The bot is still starting up.' };
    const { guildId, voiceChannelId, userId, text } = body;
    if (!guildId || !voiceChannelId || !userId || !text) {
        return { status: 400, message: 'Missing guild, channel, user or text.' };
    }
    if (text.trim() === '__wake__') return { status: 200, message: 'Listening…' };
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { status: 404, message: 'Unknown guild.' };
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { status: 404, message: 'Unknown member.' };
    if (member.voice.channelId !== voiceChannelId) {
        return { status: 403, message: 'You need to be in the voice channel to use voice commands.' };
    }
    if (!(await hasDjAccess(client, guild.id, member))) {
        return { status: 403, message: 'You need the DJ role to use voice commands.' };
    }
    if (await isVoiceOptedOut(client, guild.id, userId)) {
        // No reply at all: an opted-out member must not be acknowledged.
        return { status: 200, message: '' };
    }

    const channel = await resolveTextChannel(client, guild, body.textChannelId);
    if (!channel) return { status: 400, message: 'No text channel is configured for replies.' };

    const voice = guild.channels.cache.get(voiceChannelId);
    if (!voice || voice.type !== ChannelType.GuildVoice) {
        return { status: 400, message: 'That voice channel is not available.' };
    }

    let player: Dispatcher | undefined = client.queue.get(guild.id);
    if (!player || player.isStale) {
        try {
            player = await client.queue.create(guild, voice, channel);
        } catch (error) {
            client.logger.error(`[earl] could not create player: ${error}`);
            return { status: 500, message: 'I could not join the voice channel.' };
        }
    }

    // Voice capture can overlap itself; a repeated identical command within 6s
    // must not enqueue the same song twice. Empty message = no second reply.
    const dedupeKey = `${guildId}:${userId}:${text.trim().toLowerCase()}`;
    const now = Date.now();
    for (const [key, at] of recentCommands) if (now - at > 10_000) recentCommands.delete(key);
    const last = recentCommands.get(dedupeKey);
    if (last && now - last < 6_000) return { status: 200, message: '' };
    recentCommands.set(dedupeKey, now);

    const { verb, query } = resolveCommand(text);
    const args = query ? query.split(' ').filter(Boolean) : [];
    if (!ACTIONS.has(verb)) {
        return { status: 200, message: `I heard “${text}” but that is not a command I know.` };
    }

    switch (verb) {
        case 'play':
        case 'playnext': {
            if (!query) return { status: 200, message: 'What should I play?' };
            return await queueQuery(client, player, query, member, verb === 'playnext');
        }
        case 'skip': {
            const amount = Math.max(1, Math.min(20, Number.parseInt(args[0] ?? '1', 10) || 1));
            await player.skip(amount);
            return { status: 200, message: `Skipped ${amount} track${amount === 1 ? '' : 's'}.` };
        }
        case 'pause': {
            if (player.paused) return { status: 200, message: 'Already paused.' };
            player.pause();
            return { status: 200, message: 'Paused.' };
        }
        case 'resume': {
            if (!player.paused) return { status: 200, message: 'Already playing.' };
            player.pause();
            return { status: 200, message: 'Resumed.' };
        }
        case 'stop': {
            player.stop();
            return { status: 200, message: 'Stopped and cleared the queue.' };
        }
        case 'queue': {
            const current = player.current ? ` Now playing **${player.current.info.title}**.` : '';
            return { status: 200, message: `${player.queue.length} track${player.queue.length === 1 ? '' : 's'} queued.${current}` };
        }
        case 'np': {
            if (!player.current) return { status: 200, message: 'Nothing is playing right now.' };
            const { title, author, uri } = player.current.info;
            return { status: 200, message: `Now playing [${title}](${uri}) by ${author}.` };
        }
        case 'autoplay': {
            const desired = args[0] === 'on' ? true : args[0] === 'off' ? false : !player.autoplay;
            await player.setAutoplay(desired);
            return { status: 200, message: `Autoplay ${desired ? 'enabled' : 'disabled'}.` };
        }
        case 'volume': {
            const level = Number.parseInt(args[0] ?? '', 10);
            if (!Number.isFinite(level) || level < 0 || level > 200) {
                return { status: 200, message: 'Volume must be between 0 and 200.' };
            }
            await player.player.setGlobalVolume(level);
            return { status: 200, message: `Volume set to ${level}%.` };
        }
        default:
            return { status: 200, message: 'That command is not wired up yet.' };
    }
}

/** Turn a spoken phrase into a verb + query. People do not always start with
 * the verb ("show me the queue", "add some NF"), so handle those shapes before
 * falling back to the first-word aliases. */
const COMMAND_FIXES: Record<string, string> = {
    'y all': 'skip',
    yall: 'skip',
    yep: 'skip',
    yeah: 'skip',
    you: 'skip',
    'it s you': 'skip',
    'it s cute': 'skip',
    'its cute': 'skip',
    give: 'skip',
    git: 'skip',
    'skip it': 'skip',
};

function resolveCommand(text: string): { verb: string; query: string } {
    const phrase = text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\bauto\s+play\b/g, 'autoplay')
        .trim();
    if (COMMAND_FIXES[phrase]) return { verb: COMMAND_FIXES[phrase], query: '' };
    // Whisper renders "queue" as cue/que/q about as often as the real word.
    if (/^(show|see|whats|what is|tell me|list).*\b(queue|cue|que|q)\b/.test(phrase) || /^(queue|cue)$/.test(phrase)) {
        return { verb: 'queue', query: '' };
    }
    if (/^(turn on|enable|start|switch on)\b.*autoplay|^autoplay\s+on$|^turn\s+autoplay\s+on$/.test(phrase)) {
        return { verb: 'autoplay', query: 'on' };
    }
    if (/^(turn off|disable|stop|switch off)\b.*autoplay|^autoplay\s+off$|^turn\s+autoplay\s+off$/.test(phrase)) {
        return { verb: 'autoplay', query: 'off' };
    }
    if (/^autoplay$/.test(phrase)) return { verb: 'autoplay', query: '' };
    if (/^(whats|what is)\s+playing/.test(phrase)) return { verb: 'np', query: '' };
    if (/^queue up\b/.test(phrase)) {
        return { verb: 'play', query: cleanQuery(phrase.replace(/^queue up\s*/, '')) };
    }
    if (/^add\b/.test(phrase)) {
        const query = phrase
            .replace(/^add\s+(?:(?:some|a|another|the)\s+)?/, '')
            .replace(/^song\s+/, '')
            .trim();
        return { verb: 'play', query: correctArtist(cleanQuery(query)) };
    }
    const words = phrase.split(' ');
    const pair = `${words[0]} ${words[1] ?? ''}`.trim();
    const verb = ALIASES[pair] ?? ALIASES[words[0]] ?? words[0];
    const rest = verb === ALIASES[pair] ? words.slice(2) : words.slice(1);
    return { verb, query: correctArtist(cleanQuery(rest.join(' '))) };
}

/** "play some NF" must search "NF", not "some NF" — the filler word otherwise
 * dominates the search and returns an unrelated track. */
/** Short artist names are the worst STT case: "NF" comes back as nerf/nap/
 * "in F"/"your nerf". Correct the common ones before searching. */
const ARTIST_ALIASES: Record<string, string> = {
    nf: 'NF',
    nerf: 'NF',
    nurf: 'NF',
    nap: 'NF',
    'your nerf': 'NF',
    'your nap': 'NF',
    'in f': 'NF',
    'en ef': 'NF',
    'n f': 'NF',
    unf: 'NF',
};

function correctArtist(query: string): string {
    const key = query.trim().toLowerCase();
    return ARTIST_ALIASES[key] ?? query;
}

function cleanQuery(query: string): string {
    let out = query.trim();
    for (;;) {
        const next = out.replace(/^(?:some|me|us|the song|a song)\s+/i, '').replace(/^song\s+/i, '').trim();
        if (next === out) return out;
        out = next;
    }
}

async function queueQuery(
    client: BootstrapClient,
    player: Dispatcher,
    query: string,
    member: GuildMember,
    next: boolean
): Promise<{ status: number; message: string }> {
    const res = await client.queue.search(query);
    if (!res) return { status: 500, message: 'Search failed — no Lavalink node answered.' };

    if (res.loadType === LoadType.ERROR) {
        return { status: 500, message: 'Lavalink could not load that query.' };
    }
    if (res.loadType === LoadType.EMPTY) {
        return { status: 200, message: 'No results found.' };
    }

    const add = (track: Parameters<Dispatcher['buildTrack']>[0]): void => {
        const song = player.buildTrack(track, member.user);
        if (next) player.enqueueNext(song);
        else player.enqueue(song);
    };

    let message: string;
    if (res.loadType === LoadType.TRACK) {
        add(res.data);
        message = `Added **${res.data.info.title}**${next ? ' next' : ''}.`;
    } else if (res.loadType === LoadType.SEARCH) {
        const first = res.data[0];
        if (!first) return { status: 200, message: 'No results found.' };
        add(first);
        message = `Added **${first.info.title}**${next ? ' next' : ''}.`;
    } else if (res.loadType === LoadType.PLAYLIST) {
        let added = 0;
        for (const track of res.data.tracks) {
            if (player.queue.length >= client.config.maxQueueSize) break;
            add(track);
            added += 1;
        }
        message = `Added ${added} tracks from **${res.data.info.name}**${next ? ' next' : ''}.`;
    } else {
        return { status: 200, message: 'Nothing to add.' };
    }

    await player.isPlaying();
    return { status: 200, message };
}

async function resolveTextChannel(
    client: BootstrapClient,
    guild: Guild,
    channelId: string | undefined
): Promise<TextChannel | null> {
    const setup = await client.db.getSetup(guild.id);
    const id = channelId ?? setup?.textId;
    if (!id) return null;
    const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
    if (!(channel instanceof TextChannel)) return null;
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me || !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return null;
    return channel;
}

async function say(client: BootstrapClient, body: VoiceCommandBody, message: string): Promise<void> {
    if (!body.guildId || !body.textChannelId) return;
    const guild = client.guilds.cache.get(body.guildId);
    if (!guild) return;
    const channel = await resolveTextChannel(client, guild, body.textChannelId);
    if (!channel) return;
    await channel.send({ content: message }).catch(error => client.logger.warn(`[earl] reply failed: ${error}`));
}

const plugin = createPlugin();
export default plugin;
