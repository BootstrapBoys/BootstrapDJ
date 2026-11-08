import { defineMusicCommand } from '../../lib/musicCommand.js';
import { replyFail, replyOk } from '../../lib/reply.js';
import type { Dispatcher } from '../../core/index.js';

/** The dispatcher's own voice id, with the connection manager as a fallback. */
function voiceChannelId(player: Dispatcher, guildId: string): string | null {
    return player.voiceId ?? player.node.manager.connections.get(guildId)?.channelId ?? null;
}

export default defineMusicCommand({
    name: 'leave',
    description: { content: 'Leaves the voice channel', examples: ['leave'], usage: 'leave' },
    aliases: ['dc'],
    active: false,
    requirePlayer: false,
    run: async ({ client, ctx, player }) => {
        const guild = ctx.guild;
        if (!guild) return;
        if (!player) return await replyFail(client, ctx, "I'm not in a voice channel");

        const channelId = voiceChannelId(player, guild.id);
        try {
            await replyOk(
                client,
                ctx,
                channelId ? `Left <#${channelId}>` : 'Left the voice channel'
            );
        } finally {
            // A failed or slow reply must never keep the bot connected.
            player.destroy();
        }
    },
});
