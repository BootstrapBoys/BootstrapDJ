import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class PlaylistSearch extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playlistsearch',
            description: { content: 'Shows tracks from a matching playlist', usage: 'playlistsearch <query>', examples: ['playlistsearch lofi beats'] },
            category: 'music',
            aliases: ['plsearch', 'searchplaylist'],
            cooldown: 3,
            args: true,
            defer: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                { name: 'query', description: 'Playlist name or URL', type: ApplicationCommandOptionType.String, required: true },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const query = args.join(' ').trim();
        if (!query) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Provide a playlist query or URL.')],
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
                : res.loadType === LoadType.SEARCH
                  ? res.data
                  : res.loadType === LoadType.TRACK
                    ? [res.data]
                    : [];
        if (!tracks.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('No playlist tracks found.')],
            });
        }
        const lines = tracks
            .slice(0, 15)
            .map((track, index) => `**${index + 1}.** [${track.info.title}](${track.info.uri}) — ${track.info.author}`);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(`Playlist results: ${query}`)
                    .setDescription(`${lines.join('\n')}${tracks.length > 15 ? `\n…and ${tracks.length - 15} more` : ''}`),
            ],
        });
    }
}
