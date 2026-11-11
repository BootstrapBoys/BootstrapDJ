import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyOk } from '../../lib/reply.js';
import type { Dispatcher } from '../../core/index.js';

/** The dispatcher's own voice id, with the connection manager as a fallback. */
function voiceChannelId(player: Dispatcher, guildId: string): string | null {
    return player.voiceId ?? player.node.manager.connections.get(guildId)?.channelId ?? null;
}

function channelLabel(ctx: Parameters<typeof tr>[0], channelId: string | null): string {
    return channelId ? `<#${channelId}>` : tr(ctx, 'commands:core.voiceChannel');
}

export default defineMusicCommand({
    name: 'join',
    description: { content: 'Joins the voice channel', examples: ['join'], usage: 'join' },
    aliases: ['j'],
    dj: false,
    active: false,
    requirePlayer: false,
    run: async ({ client, ctx, player }) => {
        const guild = ctx.guild;
        if (!guild) return;

        if (player && !player.isStale) {
            return await replyOk(
                client,
                ctx,
                tr(ctx, 'commands:core.alreadyConnected', {
                    channel: channelLabel(ctx, voiceChannelId(player, guild.id)),
                })
            );
        }

        const created = await client.queue.create(
            guild,
            ctx.voiceChannel,
            ctx.channel,
            client.shoukaku.options.nodeResolver(client.shoukaku.nodes)
        );
        return await replyOk(
            client,
            ctx,
            tr(ctx, 'commands:core.joined', {
                channel: channelLabel(ctx, voiceChannelId(created, guild.id)),
            })
        );
    },
});
