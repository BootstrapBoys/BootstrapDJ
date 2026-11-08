import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType, Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

/** The rows an import may add: whole playlists expand, searches take one hit. */
function tracksFor(loadType: LoadType, data: unknown): Track[] {
    switch (loadType) {
        case LoadType.PLAYLIST:
            return [...(data as { tracks: Track[] }).tracks];
        case LoadType.TRACK:
            return [data as Track];
        case LoadType.SEARCH: {
            const hits = data as Track[];
            return hits.length > 0 ? [hits[0]] : [];
        }
        default:
            return [];
    }
}

export default class Add extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'add',
            description: {
                content: 'Adds a song to the playlist',
                examples: ['add <playlist> <song>'],
                usage: 'add <playlist> <song>',
            },
            category: 'playlist',
            aliases: ['add'],
            cooldown: 3,
            args: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            defer: true,
            options: [
                {
                    name: 'playlist',
                    description: 'The playlist you want to add',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true,
                },
                {
                    name: 'song',
                    description: 'The song you want to add',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({ embeds: [{ description: text, color: client.color.red }] });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const name = (args[0] ?? '').trim();
        const query = (args[1] ?? '').trim();
        if (!name) return await this.fail(client, ctx, 'Please provide a playlist');
        if (!query) return await this.fail(client, ctx, 'Please provide a song');

        const playlist = await client.db.getPLaylist(author.id, name);
        if (!playlist) return await this.fail(client, ctx, 'That playlist doesn\'t exist');

        const result = await client.queue.search(query, await resolveSearchEngine(client, ctx));
        const tracks = result ? tracksFor(result.loadType, result.data) : [];
        if (tracks.length === 0) return await this.fail(client, ctx, 'No songs found');

        let added = 0;
        let duplicates = 0;
        for (const track of tracks) {
            if (await client.db.addSong(author.id, name, track)) added += 1;
            else duplicates += 1;
        }
        const suffix = duplicates > 0 ? ` (${duplicates} already in the playlist)` : '';
        return await ctx.sendMessage({
            embeds: [{ description: `Added ${added} to ${playlist.name}${suffix}`, color: client.color.green }],
        });
    }
}
