import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType, Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class PlaySelect extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playselect',
            description: { content: 'Queues the first track from a playlist URL', usage: 'playselect <url>', examples: ['playselect https://www.deezer.com/playlist/…'] },
            category: 'music',
            aliases: ['pselect'],
            cooldown: 3,
            args: true,
            defer: true,
            player: { voice: true, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                {
                    name: 'url',
                    description: 'Playlist URL or search term',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const query = args.join(' ').trim();
        if (!query) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Provide a playlist URL or search term.')],
            });
        }
        let player = client.queue.get(guild.id);
        if (!player || player.isStale) player = await client.queue.create(guild, ctx.voiceChannel, ctx.channel);
        const res = await client.queue.search(query);
        if (!res) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('No results found.')],
            });
        }
        const tracks: Track[] =
            res.loadType === LoadType.PLAYLIST
                ? res.data.tracks
                : res.loadType === LoadType.TRACK
                  ? [res.data]
                  : res.loadType === LoadType.SEARCH
                    ? res.data
                    : [];
        const track = tracks[0];
        if (!track) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('No tracks found.')],
            });
        }
        const song = player.buildTrack(track, author);
        player.enqueue(song);
        await player.isPlaying();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Queued [${song.info.title}](${song.info.uri}).`),
            ],
        });
    }
}
