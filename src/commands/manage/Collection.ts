import { ApplicationCommandOptionType, ChannelType, ColorResolvable } from 'discord.js';
import { randomBytes } from 'node:crypto';
import { LoadType, Track } from 'shoukaku';

import { BootstrapClient, Command, Context, Song } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

const NAME_LIMIT = 50;
const LIST_LIMIT = 25;
const VIEW_LIMIT = 20;
const IMPORT_LIMIT = 20;

type StoredRow = Awaited<ReturnType<BootstrapClient['db']['getSong']>>[number];

interface Request {
    action: string;
    name: string;
    query: string;
    target: string;
    index: number;
    code: string;
    authorId: string;
}

/** A stored row may predate per-track rows: it then holds an array. */
function storedTracks(row: StoredRow): unknown[] | null {
    try {
        const parsed: unknown = JSON.parse(row.track);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return null;
    }
}

function songKey(track: Track): string {
    if (track.info.uri) return track.info.uri;
    if (track.info.identifier && track.info.sourceName) {
        return `${track.info.sourceName}:${track.info.identifier}`;
    }
    return track.encoded;
}

export default class Collection extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'playlist',
            description: {
                content: 'Manage saved playlists',
                usage: 'playlist <action> [name] [query]',
                examples: ['playlist list', 'playlist load roadtrip'],
            },
            category: 'playlist',
            aliases: ['collection', 'collections', 'col'],
            cooldown: 3,
            args: true,
            defer: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'action',
                    description: 'Collection operation',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'list', value: 'list' },
                        { name: 'create', value: 'create' },
                        { name: 'delete', value: 'delete' },
                        { name: 'view', value: 'view' },
                        { name: 'add', value: 'add' },
                        { name: 'remove', value: 'remove' },
                        { name: 'removesong', value: 'removesong' },
                        { name: 'save', value: 'save' },
                        { name: 'load', value: 'load' },
                        { name: 'rename', value: 'rename' },
                        { name: 'copy', value: 'copy' },
                        { name: 'clone', value: 'clone' },
                        { name: 'merge', value: 'merge' },
                        { name: 'clear', value: 'clear' },
                        { name: 'share', value: 'share' },
                        { name: 'import', value: 'import' },
                        { name: 'unshare', value: 'unshare' },
                        { name: 'shares', value: 'shares' },
                    ],
                },
                {
                    name: 'name',
                    description: 'Collection name',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    autocomplete: true,
                },
                {
                    name: 'query',
                    description: 'Track or playlist URL for add',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    autocomplete: true,
                },
                {
                    name: 'target',
                    description: 'Destination name for rename/copy/merge',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    autocomplete: true,
                },
                {
                    name: 'index',
                    description: '1-based track position for remove',
                    type: ApplicationCommandOptionType.Integer,
                    required: false,
                    minValue: 1,
                },
                { name: 'code', description: 'Share code', type: ApplicationCommandOptionType.String, required: false },
            ],
        });
    }

    private option(ctx: Context, name: string, position: number): string {
        if (ctx.isInteraction && ctx.interaction) {
            return (ctx.interaction.options.getString(name) ?? '').trim();
        }
        return (ctx.args[position] ?? '').trim();
    }

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({ embeds: [client.embed().setColor(client.color.red).setDescription(text)] });
    }

    private note(client: BootstrapClient, ctx: Context, text: string, colour: ColorResolvable): Promise<unknown> {
        return ctx.sendMessage({ embeds: [client.embed().setColor(colour).setDescription(text)] });
    }

    private read(ctx: Context): Request {
        const positional = (ctx.args[0] ?? '').trim();
        const action = (positional || this.option(ctx, 'action', 0) || 'list').toLowerCase();
        const request: Request = {
            action,
            name: this.option(ctx, 'name', 1),
            query: this.option(ctx, 'query', 2),
            target: this.option(ctx, 'target', 3),
            index: 0,
            code: this.option(ctx, 'code', 5),
            authorId: ctx.author?.id ?? '',
        };
        request.index = ctx.isInteraction
            ? (ctx.interaction?.options.getInteger('index') ?? 0)
            : Number(ctx.args[4] ?? 0);
        // Prefix import/unshare pass the code as the first argument after the
        // action, with no name slot.
        if (!ctx.isInteraction && (action === 'import' || action === 'unshare')) {
            request.code = this.option(ctx, 'code', 1);
            request.name = '';
        }
        return request;
    }

    private async copyInto(
        client: BootstrapClient,
        authorId: string,
        source: string,
        destination: string
    ): Promise<number> {
        const rows = await client.db.getSong(authorId, source);
        let copied = 0;
        for (const row of rows) {
            const entries = storedTracks(row);
            if (!entries) continue;
            for (const entry of entries) {
                if (await client.db.addSong(authorId, destination, entry)) copied += 1;
            }
        }
        return copied;
    }

    private async list(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        const playlists = await client.db.getPlaylists(request.authorId);
        if (playlists.length === 0) {
            return await this.note(client, ctx, 'You have no collections yet.', client.color.main);
        }
        const lines = playlists
            .slice(0, LIST_LIMIT)
            .map(item => `**${item.name}** — ${item._count.songs} track${item._count.songs === 1 ? '' : 's'}`);
        return await ctx.sendMessage({
            embeds: [
                client.embed().setColor(client.color.main).setTitle('Your collections').setDescription(lines.join('\n')),
            ],
        });
    }

    private async shares(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        const shares = await client.db.listCollectionShares(request.authorId);
        if (shares.length === 0) {
            return await this.note(client, ctx, 'You have no shared collections.', client.color.main);
        }
        const lines = shares.map(share => `\`${share.code}\` — **${share.name}**`);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Collection share codes')
                    .setDescription(lines.join('\n')),
            ],
        });
    }

    private async import(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (!request.code) return await this.fail(client, ctx, 'Provide a share code.');
        const share = await client.db.getCollectionShare(request.code);
        if (!share) return await this.fail(client, ctx, 'That share code is not valid.');

        const destination = request.name || `${share.name} (imported)`;
        if (await client.db.getPLaylist(request.authorId, destination)) {
            return await this.fail(client, ctx, 'A collection with that name already exists.');
        }
        await client.db.createPlaylist(request.authorId, destination);
        const copied = await this.copyInto(client, request.authorId, share.name, destination);
        return await this.note(
            client,
            ctx,
            `Imported **${share.name}** as **${destination}** (${copied} tracks).`,
            client.color.main
        );
    }

    private async unshare(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (!request.code) return await this.fail(client, ctx, 'Provide a share code.');
        const removed = await client.db.deleteCollectionShare(request.authorId, request.code);
        return await this.note(
            client,
            ctx,
            removed ? 'Share code removed.' : 'That share code is not yours.',
            removed ? client.color.green : client.color.red
        );
    }

    private async create(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (request.name.length > NAME_LIMIT) {
            return await this.fail(client, ctx, 'Collection names can be at most 50 characters.');
        }
        if (await client.db.getPLaylist(request.authorId, request.name)) {
            return await this.fail(client, ctx, 'That collection already exists.');
        }
        await client.db.createPlaylist(request.authorId, request.name);
        return await this.note(client, ctx, `Created collection **${request.name}**.`, client.color.green);
    }

    private async delete(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        const removed = await client.db.deletePlaylist(request.authorId, request.name);
        return await this.note(
            client,
            ctx,
            removed ? `Deleted collection **${request.name}**.` : 'That collection does not exist.',
            removed ? client.color.green : client.color.red
        );
    }

    private async save(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (request.name.length > NAME_LIMIT) {
            return await this.fail(client, ctx, 'Collection names can be at most 50 characters.');
        }
        if (!ctx.guild) return;
        const player = client.queue.get(ctx.guild.id);
        if (!player?.current) return await this.fail(client, ctx, 'Nothing is playing right now.');

        let added = 0;
        for (const track of [player.current, ...player.queue]) {
            if (await client.db.addSong(request.authorId, request.name, track)) added += 1;
        }
        return await this.note(
            client,
            ctx,
            `Saved **${added}** track${added === 1 ? '' : 's'} to **${request.name}**.`,
            client.color.main
        );
    }

    private async share(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        let code = randomBytes(4).toString('hex');
        while (await client.db.getCollectionShare(code)) code = randomBytes(4).toString('hex');
        await client.db.createCollectionShare(request.authorId, request.name, code);
        return await this.note(
            client,
            ctx,
            `Share code for **${request.name}**: \`${code}\`\nUse \`collection import\` with this code to copy it.`,
            client.color.main
        );
    }

    private async view(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        const rows = await client.db.getSong(request.authorId, request.name);
        if (rows.length === 0) {
            return await this.note(client, ctx, `**${request.name}** is empty.`, client.color.main);
        }
        const lines = rows.slice(0, VIEW_LIMIT).map((row, position) => {
            try {
                const parsed = JSON.parse(row.track) as { info?: { title?: string; author?: string } };
                return `**${position + 1}.** ${parsed.info?.title ?? 'Unknown'} — ${parsed.info?.author ?? ''}`;
            } catch {
                return `**${position + 1}.** Unknown track`;
            }
        });
        const suffix = rows.length > VIEW_LIMIT ? `\n…and ${rows.length - VIEW_LIMIT} more` : '';
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(request.name)
                    .setDescription(`${lines.join('\n')}${suffix}`),
            ],
        });
    }

    private async clear(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        await client.db.clearPlaylist(request.authorId, request.name);
        return await this.note(client, ctx, `Cleared **${request.name}**.`, client.color.green);
    }

    private async removeSong(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (!request.query) return await this.fail(client, ctx, 'Provide a track name or URL to remove.');
        if (!client.queue.hasNode) return await this.fail(client, ctx, 'No Lavalink node is available right now.');

        const track = client.utils.firstTrack(
            await client.queue.search(request.query, await resolveSearchEngine(client, ctx))
        );
        if (!track) return await this.fail(client, ctx, `No results found for **${request.query}**.`);

        const removed = await client.db.removeSong(request.authorId, request.name, songKey(track));
        const label = `[${track.info.title}](${track.info.uri})`;
        return await this.note(
            client,
            ctx,
            removed ? `Removed ${label} from **${request.name}**.` : `${label} is not in **${request.name}**.`,
            removed ? client.color.green : client.color.red
        );
    }

    private async removeAt(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (!request.index) return await this.fail(client, ctx, 'Provide the 1-based track index to remove.');
        const removed = await client.db.removeSongAt(request.authorId, request.name, request.index);
        return await this.note(
            client,
            ctx,
            removed ? `Removed track ${request.index} from **${request.name}**.` : 'No track at that index.',
            removed ? client.color.green : client.color.red
        );
    }

    private async add(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (!request.query) return await this.fail(client, ctx, 'Provide a track, search term, or playlist URL.');
        const result = await client.queue.search(request.query, await resolveSearchEngine(client, ctx));
        if (!result) return await this.fail(client, ctx, 'No results found.');

        let tracks: Track[] = [];
        if (result.loadType === LoadType.PLAYLIST) tracks = result.data.tracks;
        else if (result.loadType === LoadType.TRACK) tracks = [result.data];
        else if (result.loadType === LoadType.SEARCH) tracks = result.data.slice(0, IMPORT_LIMIT);

        let added = 0;
        for (const track of tracks) {
            if (await client.db.addSong(request.authorId, request.name, track)) added += 1;
        }
        return await this.note(
            client,
            ctx,
            `Added ${added} track${added === 1 ? '' : 's'} to **${request.name}**.`,
            client.color.main
        );
    }

    private async replicate(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (!request.target) return await this.fail(client, ctx, 'Provide a target collection name.');
        const merge = request.action === 'merge';
        if (!merge && (await client.db.getPLaylist(request.authorId, request.target))) {
            return await this.fail(client, ctx, 'The target collection already exists.');
        }
        if (!merge) await client.db.createPlaylist(request.authorId, request.target);
        const copied = await this.copyInto(client, request.authorId, request.name, request.target);
        if (request.action === 'rename') await client.db.deletePlaylist(request.authorId, request.name);

        const verb = merge
            ? 'Merged'
            : request.action === 'rename'
              ? 'Renamed'
              : request.action === 'clone'
                ? 'Cloned'
                : 'Copied';
        return await this.note(
            client,
            ctx,
            `${verb} **${request.name}** → **${request.target}** (${copied} tracks).`,
            client.color.main
        );
    }

    private async load(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        const voice = ctx.voiceChannel;
        if (!voice || (voice.type !== ChannelType.GuildVoice && voice.type !== ChannelType.GuildStageVoice)) {
            return await this.fail(client, ctx, 'Join a voice channel first.');
        }
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;

        const rows = await client.db.getSong(request.authorId, request.name);
        if (rows.length === 0) return await this.fail(client, ctx, 'That collection is empty.');

        let player = client.queue.get(guild.id);
        if (!player || player.isStale) player = await client.queue.create(guild, voice, ctx.channel);

        const queued: Song[] = [];
        let skipped = 0;
        for (const row of rows) {
            const entries = storedTracks(row);
            if (!entries) {
                skipped += 1;
                continue;
            }
            for (const entry of entries) {
                if (player.queue.length >= client.config.maxQueueSize) {
                    skipped += 1;
                    continue;
                }
                const song = player.buildTrack(entry as Song, author);
                player.enqueue(song, false, false);
                queued.push(song);
            }
        }

        player.seedPlaylist(queued);
        await player.isPlaying();
        const suffix = skipped > 0 ? ` (${skipped} skipped)` : '';
        return await this.note(
            client,
            ctx,
            `Loaded **${request.name}** with ${queued.length} track${queued.length === 1 ? '' : 's'}${suffix}.`,
            client.color.main
        );
    }

    public async run(client: BootstrapClient, ctx: Context, _args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const request = this.read(ctx);
        client.logger.info(
            `[playlist] action=${request.action} name=${request.name} args=${ctx.args.join('|')}`
        );

        switch (request.action) {
            case 'list':
                return await this.list(client, ctx, request);
            case 'shares':
                return await this.shares(client, ctx, request);
            case 'import':
                return await this.import(client, ctx, request);
            case 'unshare':
                return await this.unshare(client, ctx, request);
            default:
                break;
        }

        if (!request.name) return await this.fail(client, ctx, 'Provide a collection name.');

        switch (request.action) {
            case 'create':
                return await this.create(client, ctx, request);
            case 'delete':
                return await this.delete(client, ctx, request);
            case 'save':
                return await this.save(client, ctx, request);
            default:
                break;
        }

        const collection = await client.db.getPLaylist(request.authorId, request.name);
        if (!collection) return await this.fail(client, ctx, 'That collection does not exist.');

        switch (request.action) {
            case 'share':
                return await this.share(client, ctx, request);
            case 'view':
                return await this.view(client, ctx, request);
            case 'clear':
                return await this.clear(client, ctx, request);
            case 'removesong':
                return await this.removeSong(client, ctx, request);
            case 'remove':
                return await this.removeAt(client, ctx, request);
            case 'add':
                return await this.add(client, ctx, request);
            case 'copy':
            case 'clone':
            case 'merge':
            case 'rename':
                return await this.replicate(client, ctx, request);
            case 'load':
                return await this.load(client, ctx, request);
            default:
                return await this.fail(client, ctx, 'Unknown collection action.');
        }
    }
}
