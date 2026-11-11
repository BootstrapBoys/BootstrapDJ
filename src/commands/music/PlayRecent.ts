import { ApplicationCommandOptionType } from 'discord.js';

import { fromSaved, SavedTrack } from '../../core/Dispatcher.js';
import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { checkTrack, getPlayLimits } from '../../lib/PlayLimits.js';
import { trackIdentity } from '../../lib/QueueTools.js';

export default class PlayRecent extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playrecent',
            description: {
                content: 'Queues tracks from recent playback history',
                usage: 'playrecent [count]',
                examples: ['playrecent 5'],
            },
            category: 'music',
            aliases: ['pr'],
            cooldown: 3,
            args: false,
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
                    name: 'count',
                    description: 'How many recent tracks to queue (1-20)',
                    type: ApplicationCommandOptionType.Integer,
                    required: false,
                    minValue: 1,
                    maxValue: 20,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        let player = client.queue.get(guild.id);
        const vc = ctx.voiceChannel;
        if (!player || player.isStale) player = await client.queue.create(guild, vc, ctx.channel);
        const count = Math.min(20, Math.max(1, Number(args[0]) || 5));
        // Fetch one extra row because the currently playing track is recorded
        // as recent when it starts, but should not be re-queued behind itself.
        // Prefer the durable table; fall back to the in-memory dispatcher
        // history for rows written before the table existed.
        const stored = await client.db.getRecentTracks(guild.id, count + 1).catch(() => []);
        const currentId = player.current ? trackIdentity(player.current) : null;
        const recent = (
            stored.length
                ? stored
                      .map(row => {
                          try {
                              return fromSaved(JSON.parse(row.payload) as SavedTrack, author);
                          } catch {
                              return null;
                          }
                      })
                      .filter((track): track is NonNullable<typeof track> => Boolean(track))
                      .reverse()
                : player.history.slice(-(count + 1))
        )
            .filter(track => !currentId || trackIdentity(track) !== currentId)
            .slice(-count);
        if (!recent.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.playrecent.noHistory')),
                ],
            });
        }
        const limits = await getPlayLimits(client, guild.id);
        const accepted: typeof recent = [];
        for (const track of recent) {
            if (checkTrack(player, track, author.id, limits, [], ctx.locale)) break;
            player.enqueue(track, true, false);
            accepted.push(track);
        }
        if (!accepted.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.playrecent.noneFit')),
                ],
            });
        }
        void player.persist();
        await player.isPlaying();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        accepted.length === 1
                            ? tr(ctx, 'longtail:music.playrecent.queuedOne')
                            : tr(ctx, 'longtail:music.playrecent.queued', {
                                  count: accepted.length,
                              })
                    ),
            ],
        });
    }
}
