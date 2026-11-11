import { ChannelType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { requesterId } from '../../lib/QueueTools.js';

export default class RemoveAbsent extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'removeabsent',
            description: {
                content: 'Removes tracks requested by users not in the voice channel',
                usage: 'removeabsent',
                examples: ['removeabsent'],
            },
            category: 'music',
            aliases: ['ra'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: true, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player?.current || !player.queue.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.removeabsent.empty')),
                ],
            });
        }
        const channel = player.voiceId ? guild.channels.cache.get(player.voiceId) : null;
        if (
            !channel ||
            (channel.type !== ChannelType.GuildVoice &&
                channel.type !== ChannelType.GuildStageVoice)
        ) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.removeabsent.notInVoice')),
                ],
            });
        }
        const present = new Set(channel.members.keys());
        const before = player.queue.length;
        player.queue = player.queue.filter(track => {
            const requester = requesterId(track);
            return requester === 'unknown' || present.has(requester);
        });
        const removed = before - player.queue.length;
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        removed === 0
                            ? tr(ctx, 'longtail:music.removeabsent.noneRemoved')
                            : removed === 1
                              ? tr(ctx, 'longtail:music.removeabsent.removedOne')
                              : tr(ctx, 'longtail:music.removeabsent.removed', { count: removed })
                    ),
            ],
        });
    }
}
