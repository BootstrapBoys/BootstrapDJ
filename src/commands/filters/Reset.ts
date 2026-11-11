import { defineFilterCommand } from '../../lib/filterCommand.js';
import { tr } from '../../lib/i18nContext.js';

export default defineFilterCommand({
    name: 'reset',
    description: { content: 'Resets the active filters', examples: ['reset'], usage: 'reset' },
    aliases: ['reset'],
    active: false,
    missingPlayer: ctx => tr(ctx, 'longtail:filters.nothingPlaying'),
    run: async ({ client, ctx, player }) => {
        try {
            await player.player.clearFilters();
        } catch (error) {
            client.logger.warn(`[filter] reset write failed: ${error}`);
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: tr(ctx, 'longtail:filters.resetFailed'),
                        color: client.color.red,
                    },
                ],
            });
        }
        player.filters = [];
        player.filterValues = {};
        return await ctx.sendMessage({
            embeds: [
                {
                    description: tr(ctx, 'longtail:filters.resetDone'),
                    color: client.color.main,
                },
            ],
        });
    },
});
