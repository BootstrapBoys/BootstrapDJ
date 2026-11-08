import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType, Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

function tracksFrom(result: { loadType: LoadType; data: unknown }): Track[] {
    if (result.loadType === LoadType.PLAYLIST) return (result.data as { tracks: Track[] }).tracks;
    if (result.loadType === LoadType.TRACK) return [result.data as Track];
    if (result.loadType === LoadType.SEARCH) {
        const data = result.data as Track[];
        return data.length ? [data[0]] : [];
    }
    return [];
}

export default class Add extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'add',
            description: { content: 'Adds a song to the playlist', examples: ['add <playlist> <song>'], usage: 'add <playlist> <song>' },
            category: 'playlist',
            aliases: ['add'],
            cooldown: 3,
            args: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: false,
            defer: true,
            options: [
                { name: 'playlist', description: 'The playlist you want to add', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
                { name: 'song', description: 'The song you want to add', type: ApplicationCommandOptionType.String, required: true },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        if (!ctx.author) return;
        const [name, query] = args;
        if (!name) {
            return await ctx.sendMessage({ embeds: [{ description: 'Please provide a playlist', color: client.color.red }] });
        }
        if (!query) {
            return await ctx.sendMessage({ embeds: [{ description: 'Please provide a song', color: client.color.red }] });
        }
        const playlist = await client.db.getPLaylist(ctx.author.id, name);
        if (!playlist) {
            return await ctx.sendMessage({ embeds: [{ description: 'That playlist doesn\'t exist', color: client.color.red }] });
        }
        const result = await client.queue.search(query, await resolveSearchEngine(client, ctx));
        const tracks = result ? tracksFrom(result) : [];
        if (!tracks.length) {
            return await ctx.sendMessage({ embeds: [{ description: 'No songs found', color: client.color.red }] });
        }

        let added = 0;
        let duplicates = 0;
        for (const track of tracks) {
            if (await client.db.addSong(ctx.author.id, name, track)) added++;
            else duplicates++;
        }
        return await ctx.sendMessage({
            embeds: [
                {
                    description: `Added ${added} to ${playlist.name}${duplicates ? ` (${duplicates} already in the playlist)` : ''}`,
                    color: client.color.green,
                },
            ],
        });
    }
}
