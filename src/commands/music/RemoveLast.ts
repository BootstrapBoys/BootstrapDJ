import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class RemoveLast extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'removelast',
            description: { content: 'Removes the last queued track', usage: 'removelast', examples: ['removelast'] },
            category: 'music',
            aliases: ['rl'],
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
        const track = player.queue.pop();
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Removed **${track?.info.title ?? 'track'}** from the queue.`),
            ],
        });
    }
}
