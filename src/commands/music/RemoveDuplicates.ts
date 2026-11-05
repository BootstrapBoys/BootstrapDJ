import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { dedupeQueue } from '../../utils/QueueTools.js';

export default class RemoveDuplicates extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'removeduplicates',
            description: { content: 'Removes duplicate queued tracks', usage: 'removeduplicates', examples: ['removeduplicates'] },
            category: 'music',
            aliases: ['rd', 'dedupe'],
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
                embeds: [client.embed().setColor(client.color.red).setDescription('The queue is empty.')],
            });
        }
        const before = player.queue.length;
        player.queue = dedupeQueue(player.queue);
        const removed = before - player.queue.length;
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        removed
                            ? `Removed ${removed} duplicate track${removed === 1 ? '' : 's'}.`
                            : 'No duplicate tracks found.'
                    ),
            ],
        });
    }
}
