import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType, Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class PlaySingle extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playsingle',
            description: { content: 'Queues one random track from a playlist URL', usage: 'playsingle <url>', examples: ['playsingle https://www.deezer.com/playlist/…'] },
            category: 'music',
            aliases: ['ps', 'singleplay'],
            cooldown: 3,
            args: true,
            defer: true,
            player: { voice: true, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
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

    private pick(tracks: Track[]): Track | null {
        if (!tracks.length) return null;
        return tracks[Math.floor(Math.random() * tracks.length)];
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const author = ctx.author;
        if (!author) return;
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
            res.loadType === LoadType.PLAYLIST ? res.data.tracks : res.loadType === LoadType.TRACK ? [res.data] : res.loadType === LoadType.SEARCH ? res.data : [];
        const track = this.pick(tracks);
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
