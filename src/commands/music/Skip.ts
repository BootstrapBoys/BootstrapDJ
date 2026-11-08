import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'skip',
    description: { content: 'Skips the current song', examples: ['skip'], usage: 'skip' },
    aliases: ['sk'],
    run: async ({ client, ctx, player }) => {
        if (!player) return;
        if (!player.queue.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('There are no songs in the queue.')],
            });
        }
        player.skip();
        if (!ctx.isInteraction) {
            void ctx.message?.react('👍').catch(() => {});
            return;
        }
        const current = player.current;
        if (!current) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing playing right now')],
            });
        }
        if (!ctx.isInteraction) {
            void ctx.message?.react('👍').catch(() => {});
            return;
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Skipped [${current.info.title}](${current.info.uri})`),
            ],
        });
    },
});
