import { ChannelType, Guild, GuildMember, PermissionFlagsBits, TextChannel } from 'discord.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Dispatcher } from '../../structures/index.js';
import { hasDjAccess, isVoiceOptedOut } from '../../utils/VoiceAccess.js';
import { BotPlugin } from '../index.js';

interface VoiceCommandBody {
    guildId?: string;
    voiceChannelId?: string;
    textChannelId?: string;
    userId?: string;
    text?: string;
}

/** Commands Earl may run. Everything else is a no-op, so a misheard word cannot
 * reach destructive commands. */
const ACTIONS = new Set(['play', 'playnext', 'skip', 'pause', 'resume', 'stop', 'queue', 'np', 'volume']);

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

function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
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

                server = createServer(async (req, res) => {
                    if (req.method !== 'POST' || req.url !== '/voice/command') {
                        return send(res, 404, { error: 'not found' });
                    }
                    if (req.headers.authorization !== `Bearer ${secret}`) {
                        return send(res, 401, { error: 'unauthorized' });
                    }
                    try {
                        const raw = await readBody(req);
                        const body = JSON.parse(raw || '{}') as VoiceCommandBody;
                        const result = await handle(client, body);
                        if (result.message) {
                            await say(client, body, result.message);
                        }
                        return send(res, result.status, { ok: result.status < 400, message: result.message });
                    } catch (error) {
                        client.logger.error(`[earl] bridge error: ${error}`);
                        return send(res, 500, { error: 'internal error' });
                    }
                });

                server.listen(client.config.voiceBridgePort, '127.0.0.1', () => {
                    client.logger.info(`[earl] voice bridge on 127.0.0.1:${client.config.voiceBridgePort}`);
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
        return { status: 403, message: 'You have opted out of voice listening.' };
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

    const words = text.trim().toLowerCase().split(/\s+/);
    const pair = `${words[0]} ${words[1] ?? ''}`.trim();
    const verb = ALIASES[pair] ?? ALIASES[words[0]] ?? words[0];
    const rest = verb === ALIASES[pair] ? words.slice(2) : words.slice(1);
    const query = cleanQuery(rest.join(' '));
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
            const amount = Math.max(1, Math.min(20, Number.parseInt(rest[0] ?? '1', 10) || 1));
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
        case 'volume': {
            const level = Number.parseInt(rest[0] ?? '', 10);
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

/** "play some NF" must search "NF", not "some NF" — the filler word otherwise
 * dominates the search and returns an unrelated track. */
function cleanQuery(query: string): string {
    let out = query.trim();
    for (;;) {
        const next = out.replace(/^(?:some|me|us|the song|a song)\s+/i, '').trim();
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
