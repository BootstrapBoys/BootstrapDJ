import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyFail, replyOk } from '../../lib/reply.js';

export default defineMusicCommand({
    name: 'skip',
    description: { content: 'Skips the current song', examples: ['skip'], usage: 'skip' },
    aliases: ['sk'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        const current = player.current;
        if (!player.queue.length && !current) {
            return await replyFail(client, ctx, tr(ctx, 'commands:core.noQueue'));
        }

        player.skip();
        if (!ctx.isInteraction) {
            void ctx.message?.react('👍').catch(() => {});
            return;
        }

        if (!current) return await replyFail(client, ctx, tr(ctx, 'commands:core.nothingPlaying'));
        return await replyOk(
            client,
            ctx,
            tr(ctx, 'commands:core.skipped', {
                title: current.info.title,
                uri: current.info.uri ?? '',
            })
        );
    },
});
