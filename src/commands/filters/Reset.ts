import { defineFilterCommand } from '../../lib/filterCommand.js';

export default defineFilterCommand({
    name: 'reset',
    description: { content: 'Resets the active filters', examples: ['reset'], usage: 'reset' },
    aliases: ['reset'],
    active: false,
    missingPlayer: 'Nothing is playing right now.',
    run: async ({ client, ctx, player }) => {
        player.player.clearFilters();
        player.filters = [];
        player.filterValues = {};
        return await ctx.sendMessage({
            embeds: [{ description: 'Filters have been reset', color: client.color.main }],
        });
    },
});
