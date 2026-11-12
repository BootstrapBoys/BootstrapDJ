import {
    ApplicationCommandOptionType,
    AttachmentBuilder,
    ChannelType,
    ColorResolvable,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { LoadType, Track } from 'shoukaku';

import { BootstrapClient, Command, Context, Song } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { buildPlaylistExport, playlistExportFilename } from '../../lib/PlaylistExport.js';
import { getPlayLimits, queueHasRoom } from '../../lib/PlayLimits.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

const NAME_LIMIT = 50;
const LIST_LIMIT = 25;
const VIEW_LIMIT = 20;
const IMPORT_LIMIT = 20;
/** Discord's default upload ceiling is 25 MB; leave headroom for the embed. */
const EXPORT_LIMIT_BYTES = 24 * 1024 * 1024;

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
                        { name: 'export', value: 'export' },
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
                {
                    name: 'code',
                    description: 'Share code',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.red).setDescription(text)],
        });
    }

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:collection.${key}`, variables);
    }

    private note(
        client: BootstrapClient,
        ctx: Context,
        text: string,
        colour: ColorResolvable
    ): Promise<unknown> {
        return ctx.sendMessage({ embeds: [client.embed().setColor(colour).setDescription(text)] });
    }

    private read(ctx: Context): Request {
        const request: Request = {
            action: 'list',
            name: '',
            query: '',
            target: '',
            index: 0,
            code: '',
            authorId: ctx.author?.id ?? '',
        };
        if (ctx.isInteraction && ctx.interaction) {
            const interaction = ctx.interaction;
            return {
                ...request,
                action: (interaction.options.getString('action') ?? 'list').toLowerCase(),
                name: (interaction.options.getString('name') ?? '').trim(),
                query: (interaction.options.getString('query') ?? '').trim(),
                target: (interaction.options.getString('target') ?? '').trim(),
                index: interaction.options.getInteger('index') ?? 0,
                code: (interaction.options.getString('code') ?? '').trim(),
            };
        }

        const args = ctx.args;
        const action = (args[0] ?? 'list').trim().toLowerCase();
        request.action = action;
        if (action === 'import' || action === 'unshare') {
            // Prefix import/unshare pass the code first, with no name slot.
            request.code = (args[1] ?? '').trim();
            request.name = action === 'import' ? (args[2] ?? '').trim() : '';
            return request;
        }
        if (action === 'list' || action === 'shares') return request;

        request.name = (args[1] ?? '').trim();
        if (action === 'add' || action === 'removesong') {
            // Everything after the collection name is the search query.
            request.query = args.slice(2).join(' ').trim();
        } else if (action === 'remove') {
            request.index = Number(args[2] ?? 0);
        } else if (
            action === 'rename' ||
            action === 'copy' ||
            action === 'clone' ||
            action === 'merge'
        ) {
            // Prefix puts the target immediately after the source name; the
            // slash option order has two empty slots before it.
            request.target = (args[2] ?? '').trim();
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
            return await this.note(client, ctx, this.copy(ctx, 'noCollections'), client.color.main);
        }
        const lines = playlists
            .slice(0, LIST_LIMIT)
            .map(
                item =>
                    `**${item.name}** — ${item._count.songs} track${item._count.songs === 1 ? '' : 's'}`
            );
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(this.copy(ctx, 'listTitle'))
                    .setDescription(lines.join('\n')),
            ],
        });
    }

    private async shares(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        const shares = await client.db.listCollectionShares(request.authorId);
        if (shares.length === 0) {
            return await this.note(client, ctx, this.copy(ctx, 'noShares'), client.color.main);
        }
        const lines = shares.map(share => `\`${share.code}\` — **${share.name}**`);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(this.copy(ctx, 'sharesTitle'))
                    .setDescription(lines.join('\n')),
            ],
        });
    }

    private async import(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        if (!request.code) return await this.fail(client, ctx, this.copy(ctx, 'provideShareCode'));
        const share = await client.db.getCollectionShare(request.code);
        if (!share) return await this.fail(client, ctx, this.copy(ctx, 'invalidShareCode'));

        const destination = request.name || `${share.name} (imported)`;
        if (await client.db.getPLaylist(request.authorId, destination)) {
            return await this.fail(client, ctx, this.copy(ctx, 'nameExists'));
        }
        await client.db.createPlaylist(request.authorId, destination);
        const copied = await this.copyInto(client, request.authorId, share.name, destination);
        return await this.note(
            client,
            ctx,
            this.copy(ctx, 'imported', {
                source: share.name,
                destination,
                count: copied,
            }),
            client.color.main
        );
    }

    private async unshare(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        if (!request.code) return await this.fail(client, ctx, this.copy(ctx, 'provideShareCode'));
        const removed = await client.db.deleteCollectionShare(request.authorId, request.code);
        return await this.note(
            client,
            ctx,
            this.copy(ctx, removed ? 'shareRemoved' : 'shareNotYours'),
            removed ? client.color.green : client.color.red
        );
    }

    private async create(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        if (request.name.length > NAME_LIMIT) {
            return await this.fail(client, ctx, this.copy(ctx, 'nameTooLong'));
        }
        if (await client.db.getPLaylist(request.authorId, request.name)) {
            return await this.fail(client, ctx, this.copy(ctx, 'alreadyExists'));
        }
        await client.db.createPlaylist(request.authorId, request.name);
        return await this.note(
            client,
            ctx,
            this.copy(ctx, 'created', { name: request.name }),
            client.color.green
        );
    }

    private async delete(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        const removed = await client.db.deletePlaylist(request.authorId, request.name);
        return await this.note(
            client,
            ctx,
            this.copy(ctx, removed ? 'deleted' : 'notExist', { name: request.name }),
            removed ? client.color.green : client.color.red
        );
    }

    private async save(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (request.name.length > NAME_LIMIT) {
            return await this.fail(client, ctx, this.copy(ctx, 'nameTooLong'));
        }
        if (!ctx.guild) return;
        const player = client.queue.get(ctx.guild.id);
        if (!player?.current) return await this.fail(client, ctx, this.copy(ctx, 'nothingPlaying'));

        let added = 0;
        for (const track of [player.current, ...player.queue]) {
            if (await client.db.addSong(request.authorId, request.name, track)) added += 1;
        }
        return await this.note(
            client,
            ctx,
            this.copy(ctx, added === 1 ? 'savedOne' : 'savedMany', {
                count: added,
                name: request.name,
            }),
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
            this.copy(ctx, 'shareCode', { name: request.name, code }),
            client.color.main
        );
    }

    private async view(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        const rows = await client.db.getSong(request.authorId, request.name);
        if (rows.length === 0) {
            return await this.note(
                client,
                ctx,
                this.copy(ctx, 'empty', { name: request.name }),
                client.color.main
            );
        }
        const lines = rows.slice(0, VIEW_LIMIT).map((row, position) => {
            try {
                const parsed = JSON.parse(row.track) as {
                    info?: { title?: string; author?: string };
                };
                return `**${position + 1}.** ${parsed.info?.title ?? this.copy(ctx, 'unknownTrack')} — ${parsed.info?.author ?? ''}`;
            } catch {
                return `**${position + 1}.** ${this.copy(ctx, 'unknownTrack')}`;
            }
        });
        const suffix =
            rows.length > VIEW_LIMIT
                ? `\n${this.copy(ctx, 'more', { count: rows.length - VIEW_LIMIT })}`
                : '';
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

    private async exportPlaylist(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        const rows = await client.db.getSong(request.authorId, request.name);
        const exported = buildPlaylistExport(request.name, rows);
        if (exported.count === 0) {
            return await this.fail(client, ctx, this.copy(ctx, 'empty', { name: request.name }));
        }

        const buffer = Buffer.from(exported.text, 'utf8');
        if (buffer.byteLength > EXPORT_LIMIT_BYTES) {
            return await this.fail(client, ctx, this.copy(ctx, 'exportTooLarge'));
        }

        const description = this.copy(ctx, exported.skipped > 0 ? 'exportedSkipped' : 'exported', {
            count: exported.count,
            name: request.name,
            skipped: exported.skipped,
        });
        return await ctx.sendMessage(
            {
                embeds: [client.embed().setColor(client.color.main).setDescription(description)],
                files: [
                    new AttachmentBuilder(buffer, {
                        name: playlistExportFilename(request.name),
                    }),
                ],
            },
            0
        );
    }

    private async clear(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        await client.db.clearPlaylist(request.authorId, request.name);
        return await this.note(
            client,
            ctx,
            this.copy(ctx, 'cleared', { name: request.name }),
            client.color.green
        );
    }

    private async removeSong(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        if (!request.query) return await this.fail(client, ctx, this.copy(ctx, 'removeQuery'));
        if (!client.queue.hasNode) return await this.fail(client, ctx, this.copy(ctx, 'noNode'));

        const track = client.utils.firstTrack(
            await client.queue.search(request.query, await resolveSearchEngine(client, ctx))
        );
        if (!track)
            return await this.fail(
                client,
                ctx,
                this.copy(ctx, 'noResults', { query: request.query })
            );

        const removed = await client.db.removeSong(request.authorId, request.name, songKey(track));
        const label = `[${track.info.title}](${track.info.uri})`;
        return await this.note(
            client,
            ctx,
            this.copy(ctx, removed ? 'removedTrack' : 'notInCollection', {
                label,
                name: request.name,
            }),
            removed ? client.color.green : client.color.red
        );
    }

    private async removeAt(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        if (!request.index) return await this.fail(client, ctx, this.copy(ctx, 'indexRequired'));
        const removed = await client.db.removeSongAt(request.authorId, request.name, request.index);
        return await this.note(
            client,
            ctx,
            this.copy(ctx, removed ? 'removedIndex' : 'noIndex', {
                index: request.index,
                name: request.name,
            }),
            removed ? client.color.green : client.color.red
        );
    }

    private async add(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        if (!request.query) return await this.fail(client, ctx, this.copy(ctx, 'addQuery'));
        const result = await client.queue.search(
            request.query,
            await resolveSearchEngine(client, ctx)
        );
        if (!result) return await this.fail(client, ctx, this.copy(ctx, 'noResultsPlain'));

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
            this.copy(ctx, added === 1 ? 'addedOne' : 'addedMany', {
                count: added,
                name: request.name,
            }),
            client.color.main
        );
    }

    private async replicate(
        client: BootstrapClient,
        ctx: Context,
        request: Request
    ): Promise<unknown> {
        if (!request.target) return await this.fail(client, ctx, this.copy(ctx, 'targetRequired'));
        const merge = request.action === 'merge';
        if (!merge && (await client.db.getPLaylist(request.authorId, request.target))) {
            return await this.fail(client, ctx, this.copy(ctx, 'targetExists'));
        }
        if (!merge) await client.db.createPlaylist(request.authorId, request.target);
        const copied = await this.copyInto(client, request.authorId, request.name, request.target);
        if (request.action === 'rename')
            await client.db.deletePlaylist(request.authorId, request.name);

        const verb = this.copy(
            ctx,
            merge
                ? 'verbMerge'
                : request.action === 'rename'
                  ? 'verbRename'
                  : request.action === 'clone'
                    ? 'verbClone'
                    : 'verbCopy'
        );
        return await this.note(
            client,
            ctx,
            this.copy(ctx, 'replicated', {
                verb,
                source: request.name,
                target: request.target,
                count: copied,
            }),
            client.color.main
        );
    }

    private async load(client: BootstrapClient, ctx: Context, request: Request): Promise<unknown> {
        const voice = ctx.voiceChannel;
        if (
            !voice ||
            (voice.type !== ChannelType.GuildVoice && voice.type !== ChannelType.GuildStageVoice)
        ) {
            return await this.fail(client, ctx, this.copy(ctx, 'joinVoice'));
        }
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;

        const rows = await client.db.getSong(request.authorId, request.name);
        if (rows.length === 0)
            return await this.fail(client, ctx, this.copy(ctx, 'emptyCollection'));

        let player = client.queue.get(guild.id);
        if (!player || player.isStale)
            player = await client.queue.create(guild, voice, ctx.channel);
        const limits = await getPlayLimits(client, guild.id);

        const queued: Song[] = [];
        let skipped = 0;
        for (const row of rows) {
            const entries = storedTracks(row);
            if (!entries) {
                skipped += 1;
                continue;
            }
            for (const entry of entries) {
                if (!queueHasRoom(player, limits)) {
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
            this.copy(ctx, 'loaded', {
                name: request.name,
                count: queued.length,
                skipped: suffix,
            }),
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

        if (!request.name) return await this.fail(client, ctx, this.copy(ctx, 'provideName'));

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
        if (!collection) return await this.fail(client, ctx, this.copy(ctx, 'notExist'));

        switch (request.action) {
            case 'share':
                return await this.share(client, ctx, request);
            case 'view':
                return await this.view(client, ctx, request);
            case 'export':
                return await this.exportPlaylist(client, ctx, request);
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
                return await this.fail(client, ctx, this.copy(ctx, 'unknownAction'));
        }
    }
}
