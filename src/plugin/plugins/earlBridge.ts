import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
    ChannelType,
    Events,
    Guild,
    GuildMember,
    PermissionFlagsBits,
    TextChannel,
} from 'discord.js';
import { LoadType, type Track } from 'shoukaku';

import type { BootstrapClient, Dispatcher, Song } from '../../core/index.js';
import { checkTrack, getPlayLimits } from '../../lib/PlayLimits.js';
import { updateSetup } from '../../lib/SetupSystem.js';
import { hasDjAccess, isVoiceOptedOut } from '../../lib/VoiceAccess.js';
import type { EarlCommandBody, EarlCommandResult } from '../../types.js';
import type { BotPlugin } from '../index.js';

const MAX_BODY_BYTES = 100_000;
const DEDUPE_WINDOW_MS = 10_000;
const REPEAT_WINDOW_MS = 6_000;
const READY_RECONCILE_DELAY_MS = 15_000;
const STATUS_TIMEOUT_MS = 5_000;

/** Only these verbs may run from speech; a misheard phrase cannot reach a
 * destructive command because everything else is rejected by name. */
const VOICE_VERBS = new Set([
    'play',
    'playnext',
    'skip',
    'pause',
    'resume',
    'stop',
    'queue',
    'np',
    'volume',
    'autoplay',
]);

/** Speech-to-text reliably turns short words into homophones ("queue" -> "Q",
 * "next" -> "nex"), so the likely spellings map onto the real verbs. */
const VERB_ALIASES = new Map<string, string>([
    ['q', 'queue'],
    ['que', 'queue'],
    ['cue', 'queue'],
    ['cueue', 'queue'],
    ['queue up', 'queue'],
    ['next', 'skip'],
    ['nex', 'skip'],
    ['skip', 'skip'],
    ['nowplaying', 'np'],
    ['whats', 'np'],
    ['now playing', 'np'],
    ['pause', 'pause'],
    ['unpause', 'resume'],
    ['continue', 'resume'],
    ['resume', 'resume'],
    ['stop', 'stop'],
    ['play', 'play'],
    ['playnext', 'playnext'],
    ['volume', 'volume'],
]);

/** Whisper renders "y'all" and similar backchannels as assorted words. */
const PHRASE_FIXES = new Map<string, string>([
    ['y all', 'skip'],
    ['yall', 'skip'],
    ['yep', 'skip'],
    ['yeah', 'skip'],
    ['you', 'skip'],
    ['it s you', 'skip'],
    ['it s cute', 'skip'],
    ['its cute', 'skip'],
    ['give', 'skip'],
    ['git', 'skip'],
    ['skip it', 'skip'],
]);

/** Short artist names are the worst STT case ("NF" -> nerf/nap/"in F"). */
const ARTIST_FIXES = new Map<string, string>([
    ['nf', 'NF'],
    ['nerf', 'NF'],
    ['nurf', 'NF'],
    ['nap', 'NF'],
    ['your nerf', 'NF'],
    ['your nap', 'NF'],
    ['in f', 'NF'],
    ['en ef', 'NF'],
    ['n f', 'NF'],
    ['unf', 'NF'],
]);

interface ParsedCommand {
    verb: string;
    query: string;
}

interface CommandContext {
    guild: Guild;
    member: GuildMember;
    player: Dispatcher;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCommandResult(value: unknown): value is EarlCommandResult {
    return isRecord(value) && typeof value.status === 'number' && typeof value.message === 'string';
}

function readField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}

function readCommandBody(payload: unknown): EarlCommandBody | null {
    if (!isRecord(payload)) return null;
    return {
        guildId: readField(payload, 'guildId'),
        voiceChannelId: readField(payload, 'voiceChannelId'),
        textChannelId: readField(payload, 'textChannelId'),
        userId: readField(payload, 'userId'),
        text: readField(payload, 'text'),
    };
}

function authorized(header: string | undefined, secret: string): boolean {
    if (!header) return false;
    const provided = Buffer.from(header);
    const expected = Buffer.from(`Bearer ${secret}`);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    if (res.headersSent) {
        res.end();
        return;
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/** Bound the request body so a broken caller cannot exhaust memory. */
async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_BODY_BYTES) throw new Error('body too large');
        chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    return raw ? JSON.parse(raw) : {};
}

function cleanQuery(query: string): string {
    let value = query.trim();
    for (;;) {
        const next = value
            .replace(/^(?:some|me|us|the song|a song)\s+/i, '')
            .replace(/^song\s+/i, '')
            .trim();
        if (next === value) return value;
        value = next;
    }
}

function correctArtist(query: string): string {
    return ARTIST_FIXES.get(query.trim().toLowerCase()) ?? query;
}

/**
 * Turn a spoken phrase into a verb plus query. People often lead with filler
 * ("show me the queue", "add some NF"), so those shapes are handled before the
 * first-word aliases.
 */
function resolveCommand(text: string): ParsedCommand {
    const phrase = text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\bauto\s+play\b/g, 'autoplay')
        .trim();

    const fixed = PHRASE_FIXES.get(phrase);
    if (fixed) return { verb: fixed, query: '' };

    if (
        /^(show|see|whats|what is|tell me|list).*\b(queue|cue|que|q)\b/.test(phrase) ||
        /^(queue|cue)$/.test(phrase)
    ) {
        return { verb: 'queue', query: '' };
    }
    if (
        /^(turn on|enable|start|switch on)\b.*autoplay|^autoplay\s+on$|^turn\s+autoplay\s+on$/.test(
            phrase
        )
    ) {
        return { verb: 'autoplay', query: 'on' };
    }
    if (
        /^(turn off|disable|stop|switch off)\b.*autoplay|^autoplay\s+off$|^turn\s+autoplay\s+off$/.test(
            phrase
        )
    ) {
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
    const pairVerb = VERB_ALIASES.get(pair);
    const verb = pairVerb ?? VERB_ALIASES.get(words[0]) ?? words[0];
    const rest = pairVerb ? words.slice(2) : words.slice(1);
    return { verb, query: correctArtist(cleanQuery(rest.join(' '))) };
}

/**
 * Owns the loopback HTTP bridge and the voice-command executor. Commands go
 * through `Queue`/`Dispatcher`, so voice requests share playlist, autoplay and
 * persistence behavior with slash and prefix commands.
 */
export class EarlBridge {
    private readonly client: BootstrapClient;
    private readonly secret: string;
    private readonly recent = new Map<string, number>();
    private server: Server | null = null;
    private readyTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor(client: BootstrapClient, secret: string) {
        this.client = client;
        this.secret = secret;
    }

    public install(): void {
        this.client.earlCommand = async body => {
            const result = await this.run(body);
            if (result.message) await this.reply(body, result.message);
            return result;
        };
        this.client.earlRefreshSetup = async guildId => {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;
            await updateSetup(this.client, guild).catch(error => {
                this.client.logger.debug(`[earl] setup refresh failed for ${guildId}: ${error}`);
            });
        };
    }

    public start(): void {
        // In a sharded deployment only shard 0 binds the public bridge; the
        // other shards expose earlCommand through broadcastEval. BOTS_FILE uses
        // one process per account, and only the coordinator owns the port.
        if (this.client.shard && !this.client.isCoordinator) return;

        this.server = createServer((req, res) => {
            void this.route(req, res).catch(error => {
                this.client.logger.error(`[earl] bridge error: ${error}`);
                sendJson(res, 500, { error: 'internal error' });
            });
        });
        this.server.on('error', error => {
            this.client.logger.error(`[earl] voice bridge error: ${error}`);
        });
        this.server.listen(this.client.config.voiceBridgePort, '127.0.0.1', () => {
            this.client.logger.info(
                `[earl] voice bridge on 127.0.0.1:${this.client.config.voiceBridgePort}`
            );
        });

        this.reconcileOnStartup();
    }

    public close(): void {
        if (this.readyTimer) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        this.server?.close();
        this.server = null;
        this.recent.clear();
    }

    private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (!authorized(req.headers.authorization, this.secret)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (req.method === 'POST' && url.pathname === '/voice/listener-stopped') {
            await this.listenerStopped(req, res);
            return;
        }
        if (req.method === 'GET' && url.pathname === '/voice/optouts') {
            await this.optOuts(url, res);
            return;
        }
        if (req.method === 'POST' && url.pathname === '/voice/command') {
            await this.command(req, res);
            return;
        }
        sendJson(res, 404, { error: 'not found' });
    }

    private async listenerStopped(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            const payload = await readBody(req);
            const guildId = isRecord(payload) ? readField(payload, 'guildId') : undefined;
            if (guildId) {
                await this.client.db.setVoiceListen(guildId, { enabled: false });
                await this.refreshSetup(guildId);
            }
            sendJson(res, 200, { ok: true });
        } catch (error) {
            sendJson(res, 400, { error: String(error) });
        }
    }

    private async optOuts(url: URL, res: ServerResponse): Promise<void> {
        const guildId = url.searchParams.get('guildId') ?? '';
        const rows = guildId ? await this.client.db.listVoiceOptOuts(guildId) : [];
        sendJson(res, 200, { userIds: rows.map(row => row.userId) });
    }

    private async command(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            const body = readCommandBody(await readBody(req));
            if (!body) {
                sendJson(res, 400, { error: 'invalid body' });
                return;
            }
            const result = await this.execute(body);
            sendJson(res, result.status, { ok: result.status < 400, message: result.message });
        } catch (error) {
            this.client.logger.error(`[earl] bridge error: ${error}`);
            sendJson(res, 500, { error: 'internal error' });
        }
    }

    /** Run locally when unsharded, otherwise on the shard that owns the guild. */
    private async execute(body: EarlCommandBody): Promise<EarlCommandResult> {
        if (!this.client.shard) {
            if (!this.client.earlCommand)
                return { status: 503, message: 'The bot is still starting up.' };
            return await this.client.earlCommand(body);
        }

        const results = await this.client.shard.broadcastEval(
            async (shard, context) => {
                type CommandHost = {
                    earlCommand?: (body: EarlCommandBody) => Promise<EarlCommandResult>;
                };
                const handlesVoice = (value: unknown): value is CommandHost => {
                    if (typeof value !== 'object' || value === null) return false;
                    return Reflect.get(value, 'earlCommand') !== undefined;
                };
                const guildId = context.body.guildId ?? '';
                if (!guildId || !shard.guilds.cache.has(guildId)) return null;
                if (!handlesVoice(shard) || !shard.earlCommand) return null;
                return await shard.earlCommand(context.body);
            },
            { context: { body } }
        );

        for (const result of results) {
            if (isCommandResult(result)) return result;
        }
        return { status: 503, message: 'The bot is still starting up.' };
    }

    private async refreshSetup(guildId: string): Promise<void> {
        if (!this.client.shard) {
            await this.client.earlRefreshSetup?.(guildId);
            return;
        }
        await this.client.shard.broadcastEval(
            async (shard, context) => {
                type SetupHost = { earlRefreshSetup?: (guildId: string) => Promise<void> };
                const refreshesSetup = (value: unknown): value is SetupHost => {
                    if (typeof value !== 'object' || value === null) return false;
                    return Reflect.get(value, 'earlRefreshSetup') !== undefined;
                };
                if (!context.guildId || !shard.guilds.cache.has(context.guildId)) return false;
                if (!refreshesSetup(shard) || !shard.earlRefreshSetup) return false;
                await shard.earlRefreshSetup(context.guildId);
                return true;
            },
            { context: { guildId } }
        );
    }

    /** A listener can die without reporting it; clear the stale enabled flag. */
    private reconcileOnStartup(): void {
        this.client.once(Events.ClientReady, () => {
            this.readyTimer = setTimeout(() => {
                this.readyTimer = null;
                void this.reconcileListener();
            }, READY_RECONCILE_DELAY_MS);
        });
    }

    private async reconcileListener(): Promise<void> {
        try {
            const response = await fetch(`${this.client.config.earlControlUrl}/status`, {
                headers: { authorization: `Bearer ${this.secret}` },
                signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
            });
            if (!response.ok) return;
            const status: unknown = await response.json();
            if (!isRecord(status) || status.active) return;

            const guildId = this.client.config.guildId || this.client.guilds.cache.first()?.id;
            if (!guildId) return;
            const state = await this.client.db.getVoiceListen(guildId);
            if (!state?.enabled) return;
            await this.client.db.setVoiceListen(guildId, { enabled: false });
            await this.refreshSetup(guildId);
            this.client.logger.warn(
                '[earl] listener was not active; cleared stale listening state'
            );
        } catch {
            // The listener may still be starting; leave the state alone.
        }
    }

    private async run(body: EarlCommandBody): Promise<EarlCommandResult> {
        if (!this.client.isReady())
            return { status: 503, message: 'The bot is still starting up.' };
        const { guildId, voiceChannelId, userId, text } = body;
        if (!guildId || !voiceChannelId || !userId || !text) {
            return { status: 400, message: 'Missing guild, channel, user or text.' };
        }
        if (text.trim() === '__wake__') return { status: 200, message: 'Listening…' };

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return { status: 404, message: 'Unknown guild.' };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { status: 404, message: 'Unknown member.' };
        if (member.voice.channelId !== voiceChannelId) {
            return {
                status: 403,
                message: 'You need to be in the voice channel to use voice commands.',
            };
        }
        if (await isVoiceOptedOut(this.client, guild.id, userId)) {
            // No reply at all: an opted-out member must not be acknowledged.
            return { status: 200, message: '' };
        }
        if (!(await hasDjAccess(this.client, guild.id, member))) {
            return { status: 403, message: 'You need the DJ role to use voice commands.' };
        }

        // Resolve and validate the verb before joining: a misheard phrase must
        // not pull the bot into voice just to report that it is not a command.
        const { verb, query } = resolveCommand(text);
        if (!VOICE_VERBS.has(verb)) {
            return { status: 200, message: `I heard “${text}” but that is not a command I know.` };
        }
        if ((verb === 'play' || verb === 'playnext') && !query) {
            return { status: 200, message: 'What should I play?' };
        }
        const args = query ? query.split(' ').filter(Boolean) : [];
        if (verb === 'volume') {
            const level = Number.parseInt(args[0] ?? '', 10);
            if (!Number.isFinite(level) || level < 0 || level > 200) {
                return { status: 200, message: 'Volume must be between 0 and 200.' };
            }
        }

        // Voice capture can overlap itself; a repeated identical command within
        // 6s must not enqueue the same song twice. Empty message = no reply.
        const key = `${guildId}:${userId}:${text.trim().toLowerCase()}`;
        const now = Date.now();
        for (const [entry, at] of this.recent) {
            if (now - at > DEDUPE_WINDOW_MS) this.recent.delete(entry);
        }
        const previous = this.recent.get(key);
        if (previous !== undefined && now - previous < REPEAT_WINDOW_MS) {
            return { status: 200, message: '' };
        }
        this.recent.set(key, now);

        const channel = await this.textChannel(guild, body.textChannelId);
        if (!channel) return { status: 400, message: 'No text channel is configured for replies.' };

        const voice = guild.channels.cache.get(voiceChannelId);
        if (!voice || voice.type !== ChannelType.GuildVoice) {
            return { status: 400, message: 'That voice channel is not available.' };
        }

        let player = this.client.queue.get(guild.id);
        if (!player || player.isStale) {
            try {
                player = await this.client.queue.create(guild, voice, channel);
            } catch (error) {
                this.client.logger.error(`[earl] could not create player: ${error}`);
                return { status: 500, message: 'I could not join the voice channel.' };
            }
        }
        const active = player;
        if (!active) return { status: 500, message: 'I could not join the voice channel.' };

        const context: CommandContext = { guild, member, player: active };

        switch (verb) {
            case 'play':
            case 'playnext': {
                return await this.enqueueQuery(context, query, verb === 'playnext');
            }
            case 'skip': {
                const amount = Math.max(1, Math.min(20, Number.parseInt(args[0] ?? '1', 10) || 1));
                await active.skip(amount);
                return {
                    status: 200,
                    message: `Skipped ${amount} track${amount === 1 ? '' : 's'}.`,
                };
            }
            case 'pause': {
                if (active.paused) return { status: 200, message: 'Already paused.' };
                active.pause();
                return { status: 200, message: 'Paused.' };
            }
            case 'resume': {
                if (!active.paused) return { status: 200, message: 'Already playing.' };
                // Dispatcher.pause() toggles; the guard above makes it a resume.
                active.pause();
                return { status: 200, message: 'Resumed.' };
            }
            case 'stop': {
                active.stop();
                return { status: 200, message: 'Stopped and cleared the queue.' };
            }
            case 'queue': {
                const current = active.current
                    ? ` Now playing **${active.current.info.title}**.`
                    : '';
                return {
                    status: 200,
                    message: `${active.queue.length} track${active.queue.length === 1 ? '' : 's'} queued.${current}`,
                };
            }
            case 'np': {
                if (!active.current)
                    return { status: 200, message: 'Nothing is playing right now.' };
                const { title, author, uri } = active.current.info;
                return { status: 200, message: `Now playing [${title}](${uri}) by ${author}.` };
            }
            case 'autoplay': {
                const desired =
                    args[0] === 'on' ? true : args[0] === 'off' ? false : !active.autoplay;
                await active.setAutoplay(desired);
                return { status: 200, message: `Autoplay ${desired ? 'enabled' : 'disabled'}.` };
            }
            case 'volume': {
                const level = Number.parseInt(args[0] ?? '', 10);
                if (!Number.isFinite(level) || level < 0 || level > 200) {
                    return { status: 200, message: 'Volume must be between 0 and 200.' };
                }
                await active.player.setGlobalVolume(level);
                return { status: 200, message: `Volume set to ${level}%.` };
            }
            default:
                return { status: 200, message: 'That command is not wired up yet.' };
        }
    }

    private async enqueueQuery(
        context: CommandContext,
        query: string,
        next: boolean
    ): Promise<EarlCommandResult> {
        const response = await this.client.queue.search(query);
        if (!response)
            return { status: 500, message: 'Search failed — no Lavalink node answered.' };
        if (response.loadType === LoadType.ERROR) {
            return { status: 500, message: 'Lavalink could not load that query.' };
        }
        if (response.loadType === LoadType.EMPTY) {
            return { status: 200, message: 'No results found.' };
        }

        const limits = await getPlayLimits(this.client, context.guild.id);
        const requester = context.member.user;
        const build = (track: Track): Song => context.player.buildTrack(track, requester);
        const reject = (song: Song): string | null =>
            checkTrack(context.player, song, requester.id, limits);
        const queueFull = (): boolean =>
            context.player.queue.length >= this.client.config.maxQueueSize;

        let message: string;
        if (response.loadType === LoadType.TRACK) {
            const song = build(response.data);
            const rejected = reject(song);
            if (rejected) return { status: 200, message: rejected };
            if (queueFull()) {
                return {
                    status: 200,
                    message: `The queue is too long. The maximum length is ${this.client.config.maxQueueSize} songs.`,
                };
            }
            if (next) context.player.enqueueNext(song);
            else context.player.enqueue(song);
            message = `Added **${song.info.title}**${next ? ' next' : ''}.`;
        } else if (response.loadType === LoadType.SEARCH) {
            const first = response.data[0];
            if (!first) return { status: 200, message: 'No results found.' };
            const song = build(first);
            const rejected = reject(song);
            if (rejected) return { status: 200, message: rejected };
            if (queueFull()) {
                return {
                    status: 200,
                    message: `The queue is too long. The maximum length is ${this.client.config.maxQueueSize} songs.`,
                };
            }
            if (next) context.player.enqueueNext(song);
            else context.player.enqueue(song);
            message = `Added **${song.info.title}**${next ? ' next' : ''}.`;
        } else if (response.loadType === LoadType.PLAYLIST) {
            const playlistLimit = this.client.config.maxPlaylistSize;
            const candidates =
                playlistLimit > 0 ? response.data.tracks.slice(0, playlistLimit) : response.data.tracks;
            const accepted: Song[] = [];
            let playlistDuration = 0;
            let skipped = 0;
            for (const track of candidates) {
                if (limits.maxPlaylistTracks > 0 && accepted.length >= limits.maxPlaylistTracks) {
                    skipped += 1;
                    break;
                }
                const length = track.info.isStream ? 0 : track.info.length;
                if (
                    limits.maxPlaylistLength > 0 &&
                    playlistDuration + length > limits.maxPlaylistLength * 1000
                ) {
                    skipped += 1;
                    break;
                }
                playlistDuration += length;
                const queued = context.player.queue.length + (context.player.current ? 1 : 0);
                if (limits.maxQueue > 0 && queued + accepted.length >= limits.maxQueue) {
                    skipped += 1;
                    break;
                }
                if (
                    this.client.config.maxQueueSize > 0 &&
                    context.player.queue.length + accepted.length >= this.client.config.maxQueueSize
                ) {
                    skipped += 1;
                    break;
                }
                const song = build(track);
                if (reject(song)) {
                    skipped += 1;
                    continue;
                }
                accepted.push(song);
            }
            if (accepted.length === 0) {
                return { status: 200, message: 'No tracks from that playlist fit this server’s limits.' };
            }
            // Batch insert: persist once after the whole playlist, and reverse
            // the enqueueNext order so the playlist keeps its original order.
            const ordered = next ? [...accepted].reverse() : accepted;
            for (const song of ordered) {
                if (next) context.player.enqueueNext(song, true, false);
                else context.player.enqueue(song, true, false);
            }
            await context.player.persist();
            message = `Added ${accepted.length} track${
                accepted.length === 1 ? '' : 's'
            } from **${response.data.info.name}**${next ? ' next' : ''}${
                skipped ? ` (${skipped} skipped by server limits)` : ''
            }.`;
        } else {
            return { status: 200, message: 'Nothing to add.' };
        }

        await context.player.isPlaying();
        return { status: 200, message };
    }

    private async textChannel(guild: Guild, requestedId?: string): Promise<TextChannel | null> {
        const setup = await this.client.db.getSetup(guild.id);
        const channelId = requestedId ?? setup?.textId;
        if (!channelId) return null;
        const channel =
            guild.channels.cache.get(channelId) ??
            (await guild.channels.fetch(channelId).catch(() => null));
        if (!(channel instanceof TextChannel)) return null;
        const me = guild.members.me ?? (await guild.members.fetchMe());
        if (!me || !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return null;
        return channel;
    }

    private async reply(body: EarlCommandBody, message: string): Promise<void> {
        if (!body.guildId || !body.textChannelId) return;
        const guild = this.client.guilds.cache.get(body.guildId);
        if (!guild) return;
        const channel = await this.textChannel(guild, body.textChannelId);
        if (!channel) return;
        await channel
            .send({ content: message })
            .catch(error => this.client.logger.warn(`[earl] reply failed: ${error}`));
    }
}

function createPlugin(): BotPlugin {
    let bridge: EarlBridge | null = null;

    return {
        name: 'Earl Bridge',
        version: '1.0.0',
        author: 'Zebz213',
        initialize: (client: BootstrapClient) => {
            if (bridge) return;
            const secret = client.config.earlBridgeSecret;
            if (!secret) {
                client.logger.warn('[earl] EARL_BRIDGE_SECRET is empty — voice bridge disabled');
                return;
            }
            bridge = new EarlBridge(client, secret);
            bridge.install();
            bridge.start();
        },
        shutdown: () => {
            bridge?.close();
            bridge = null;
        },
    };
}

export default createPlugin();
