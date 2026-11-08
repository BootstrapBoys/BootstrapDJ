import { ApplicationCommandOptionType, ChannelType } from 'discord.js';
import { randomBytes } from 'node:crypto';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Command, Context, Song } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class Collection extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playlist',
            description: { content: 'Manage saved playlists', usage: 'playlist <action> [name] [query]', examples: ['playlist list', 'playlist load roadtrip'] },
            category: 'playlist',
            aliases: ['collection', 'collections', 'col'],
            cooldown: 3,
            args: true,
            defer: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
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
                { name: 'name', description: 'Collection name', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
                { name: 'query', description: 'Track or playlist URL for add', type: ApplicationCommandOptionType.String, required: false },
                { name: 'target', description: 'Destination name for rename/copy/merge', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
                { name: 'index', description: '1-based track position for remove', type: ApplicationCommandOptionType.Integer, required: false, minValue: 1 },
                { name: 'code', description: 'Share code', type: ApplicationCommandOptionType.String, required: false },
            ],
        });
    }

    private get(ctx: Context, name: string, index: number): string | null {
        if (ctx.isInteraction && ctx.interaction) {
            const value = ctx.interaction.options.get(name);
            if (value !== null && value !== undefined) {
                return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                    ? String(value)
                    : null;
            }
        }
        return ctx.args[index] ?? null;
    }

    private async copyTracks(
        client: BootstrapClient,
        authorId: string,
        source: string,
        destination: string
    ): Promise<number> {
        const rows = await client.db.getSong(authorId, source);
        let copied = 0;
        for (const row of rows) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(row.track);
            } catch {
                continue;
            }
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            for (const entry of entries) {
                if (await client.db.addSong(authorId, destination, entry)) copied++;
            }
        }
        return copied;
    }

    public async run(client: BootstrapClient, ctx: Context, _args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const action = String(ctx.args[0] ?? this.get(ctx, 'action', 0) ?? 'list').toLowerCase();
        let name = String(ctx.args[1] ?? this.get(ctx, 'name', 1) ?? '').trim();
        client.logger.info(`[playlist] action=${action} name=${name} args=${ctx.args.join('|')}`);
        const query = String(ctx.args[2] ?? this.get(ctx, 'query', 2) ?? '').trim();
        const target = String(ctx.args[3] ?? this.get(ctx, 'target', 3) ?? '').trim();
        const index = Number(ctx.args[4] ?? this.get(ctx, 'index', 4) ?? 0);
        let code = String(ctx.args[5] ?? this.get(ctx, 'code', 5) ?? '').trim();
        // Prefix syntax has no named slots: `collection import <code>` puts
        // the code in args[1], not args[5].
        if (!ctx.isInteraction && (action === 'import' || action === 'unshare')) {
            code = (this.get(ctx, 'code', 1) ?? '').trim();
            name = '';
        }

        if (action === 'list') {
            const playlists = await client.db.getPlaylists(author.id);
            if (!playlists.length) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.main).setDescription('You have no collections yet.')],
                });
            }
            const lines = playlists
                .slice(0, 25)
                .map(item => `**${item.name}** — ${item._count.songs} track${item._count.songs === 1 ? '' : 's'}`);
            return await ctx.sendMessage({
                embeds: [
                    client.embed().setColor(client.color.main).setTitle('Your collections').setDescription(lines.join('\n')),
                ],
            });
        }

        if (action === 'shares') {
            const shares = await client.db.listCollectionShares(author.id);
            if (!shares.length) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.main).setDescription('You have no shared collections.')],
                });
            }
            const lines = shares.map(share => `\`${share.code}\` — **${share.name}**`);
            return await ctx.sendMessage({
                embeds: [
                    client.embed().setColor(client.color.main).setTitle('Collection share codes').setDescription(lines.join('\n')),
                ],
            });
        }

        if (action === 'import') {
            if (!code) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Provide a share code.')],
                });
            }
            const share = await client.db.getCollectionShare(code);
            if (!share) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('That share code is not valid.')],
                });
            }
            const destination = name || `${share.name} (imported)`;
            if (await client.db.getPLaylist(author.id, destination)) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('A collection with that name already exists.')],
                });
            }
            await client.db.createPlaylist(author.id, destination);
            const copied = await this.copyTracks(client, author.id, share.name, destination);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(`Imported **${share.name}** as **${destination}** (${copied} tracks).`),
                ],
            });
        }

        if (action === 'unshare') {
            if (!code) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Provide a share code.')],
                });
            }
            const removed = await client.db.deleteCollectionShare(author.id, code);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(removed ? client.color.green : client.color.red)
                        .setDescription(removed ? 'Share code removed.' : 'That share code is not yours.'),
                ],
            });
        }

        if (!name) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Provide a collection name.')],
            });
        }

        if (action === 'create') {
            if (name.length > 50) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Collection names can be at most 50 characters.')],
                });
            }
            if (await client.db.getPLaylist(author.id, name)) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('That collection already exists.')],
                });
            }
            await client.db.createPlaylist(author.id, name);
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.green).setDescription(`Created collection **${name}**.`)],
            });
        }

        if (action === 'delete') {
            const removed = await client.db.deletePlaylist(author.id, name);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(removed ? client.color.green : client.color.red)
                        .setDescription(removed ? `Deleted collection **${name}**.` : 'That collection does not exist.'),
                ],
            });
        }

        if (action === 'save') {
            if (name.length > 50) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Collection names can be at most 50 characters.')],
                });
            }
            const guild = ctx.guild;
            const player = guild ? client.queue.get(guild.id) : null;
            if (!player?.current) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Nothing is playing right now.')],
                });
            }
            let added = 0;
            for (const track of [player.current, ...player.queue]) {
                if (await client.db.addSong(author.id, name, track)) added++;
            }
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(`Saved **${added}** track${added === 1 ? '' : 's'} to **${name}**.`),
                ],
            });
        }

        const collection = await client.db.getPLaylist(author.id, name);
        if (!collection) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('That collection does not exist.')],
            });
        }

        if (action === 'share') {
            let shareCode = randomBytes(4).toString('hex');
            while (await client.db.getCollectionShare(shareCode)) shareCode = randomBytes(4).toString('hex');
            await client.db.createCollectionShare(author.id, name, shareCode);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(`Share code for **${name}**: \`${shareCode}\`\nUse \`collection import\` with this code to copy it.`),
                ],
            });
        }

        if (action === 'view') {
            const rows = await client.db.getSong(author.id, name);
            if (!rows.length) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.main).setDescription(`**${name}** is empty.`)],
                });
            }
            const lines = rows.slice(0, 20).map((row, position) => {
                try {
                    const parsed = JSON.parse(row.track) as { info?: { title?: string; author?: string } };
                    return `**${position + 1}.** ${parsed.info?.title ?? 'Unknown'} — ${parsed.info?.author ?? ''}`;
                } catch {
                    return `**${position + 1}.** Unknown track`;
                }
            });
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle(name)
                        .setDescription(`${lines.join('\n')}${rows.length > 20 ? `\n…and ${rows.length - 20} more` : ''}`),
                ],
            });
        }

        if (action === 'clear') {
            await client.db.clearPlaylist(author.id, name);
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.green).setDescription(`Cleared **${name}**.`)],
            });
        }

        if (action === 'removesong') {
            if (!query) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Provide a track name or URL to remove.')],
                });
            }
            if (!client.queue.hasNode) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('No Lavalink node is available right now.')],
                });
            }
            const track = client.utils.firstTrack(await client.queue.search(query, await resolveSearchEngine(client, ctx)));
            if (!track) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription(`No results found for **${query}**.`)],
                });
            }
            const key =
                track.info.uri ??
                (track.info.identifier && track.info.sourceName
                    ? `${track.info.sourceName}:${track.info.identifier}`
                    : track.encoded);
            const removed = await client.db.removeSong(author.id, name, key);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(removed ? client.color.green : client.color.red)
                        .setDescription(
                            removed
                                ? `Removed [${track.info.title}](${track.info.uri}) from **${name}**.`
                                : `[${track.info.title}](${track.info.uri}) is not in **${name}**.`
                        ),
                ],
            });
        }

        if (action === 'remove') {
            if (!index) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Provide the 1-based track index to remove.')],
                });
            }
            const removed = await client.db.removeSongAt(author.id, name, index);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(removed ? client.color.green : client.color.red)
                        .setDescription(removed ? `Removed track ${index} from **${name}**.` : 'No track at that index.'),
                ],
            });
        }

        if (action === 'add') {
            if (!query) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Provide a track, search term, or playlist URL.')],
                });
            }
            const res = await client.queue.search(query, await resolveSearchEngine(client, ctx));
            if (!res) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('No results found.')],
                });
            }
            const tracks =
                res.loadType === LoadType.PLAYLIST
                    ? res.data.tracks
                    : res.loadType === LoadType.TRACK
                      ? [res.data]
                      : res.loadType === LoadType.SEARCH
                        ? res.data.slice(0, 20)
                        : [];
            let added = 0;
            for (const track of tracks) {
                if (await client.db.addSong(author.id, name, track)) added++;
            }
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(`Added ${added} track${added === 1 ? '' : 's'} to **${name}**.`),
                ],
            });
        }

        if (action === 'copy' || action === 'clone' || action === 'merge' || action === 'rename') {
            if (!target) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Provide a target collection name.')],
                });
            }
            if (action !== 'merge' && (await client.db.getPLaylist(author.id, target))) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('The target collection already exists.')],
                });
            }
            if (action !== 'merge') await client.db.createPlaylist(author.id, target);
            const copied = await this.copyTracks(client, author.id, name, target);
            if (action === 'rename') await client.db.deletePlaylist(author.id, name);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(
                            `${action === 'merge' ? 'Merged' : action === 'rename' ? 'Renamed' : action === 'clone' ? 'Cloned' : 'Copied'} **${name}** → **${target}** (${copied} tracks).`
                        ),
                ],
            });
        }

        if (action === 'load') {
            const voice = ctx.voiceChannel;
            if (!voice || (voice.type !== ChannelType.GuildVoice && voice.type !== ChannelType.GuildStageVoice)) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Join a voice channel first.')],
                });
            }
            const guild = ctx.guild;
            if (!guild) return;
            const rows = await client.db.getSong(author.id, name);
            if (!rows.length) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('That collection is empty.')],
                });
            }
            let player = client.queue.get(guild.id);
            if (!player || player.isStale) player = await client.queue.create(guild, voice, ctx.channel);
            const added: Song[] = [];
            let skipped = 0;
            for (const row of rows) {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(row.track);
                } catch {
                    skipped++;
                    continue;
                }
                const entries = Array.isArray(parsed) ? parsed : [parsed];
                for (const entry of entries) {
                    if (player.queue.length >= client.config.maxQueueSize) {
                        skipped++;
                        continue;
                    }
                    const song = player.buildTrack(entry as Song, author);
                    player.enqueue(song, false, false);
                    added.push(song);
                }
            }
            player.seedPlaylist(added);
            await player.isPlaying();
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(
                            `Loaded **${name}** with ${added.length} track${added.length === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}.`
                        ),
                ],
            });
        }

        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.red).setDescription('Unknown collection action.')],
        });
    }
}
