import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { checkTrack, getPlayLimits } from '../../lib/PlayLimits.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class PlayLeave extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playleave',
            description: {
                content: 'Plays a request and leaves voice when the queue ends',
                usage: 'playleave <query>',
                examples: ['playleave NF The Search'],
            },
            category: 'music',
            aliases: ['pleave'],
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
                    name: 'query',
                    description: 'Track, search term, or playlist URL',
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
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.playleave.provideQuery')),
                ],
            });
        }
        const res = await client.queue.search(query, await resolveSearchEngine(client, ctx));
        if (!res) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.playleave.noResults')),
                ],
            });
        }
        const tracks =
            res.loadType === LoadType.PLAYLIST
                ? res.data.tracks
                : res.loadType === LoadType.TRACK
                  ? [res.data]
                  : res.loadType === LoadType.SEARCH
                    ? res.data.slice(0, 50)
                    : [];
        if (!tracks.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.playleave.noTracks')),
                ],
            });
        }
        let player = client.queue.get(guild.id);
        if (!player || player.isStale)
            player = await client.queue.create(guild, ctx.voiceChannel, ctx.channel);
        const limits = await getPlayLimits(client, guild.id);
        const accepted: typeof tracks = [];
        let rejection: string | null = null;
        for (const track of tracks.slice(
            0,
            limits.maxPlaylistTracks || client.config.maxPlaylistSize
        )) {
            const song = player.buildTrack(track, author);
            rejection = checkTrack(player, song, author.id, limits, [], ctx.locale);
            if (rejection) break;
            player.enqueue(song, true, false);
            accepted.push(track);
        }
        if (!accepted.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(
                            rejection ?? tr(ctx, 'longtail:music.playleave.noAccepted')
                        ),
                ],
            });
        }
        void player.persist();
        player.leaveOnEnd = true;
        await player.isPlaying();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        accepted.length === 1
                            ? tr(ctx, 'longtail:music.playleave.queuedOne')
                            : tr(ctx, 'longtail:music.playleave.queued', {
                                  count: accepted.length,
                              })
                    ),
            ],
        });
    }
}
