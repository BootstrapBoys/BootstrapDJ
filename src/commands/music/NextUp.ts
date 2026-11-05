import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class NextUp extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'nextup',
            description: { content: 'Shows the next queued tracks', usage: 'nextup', examples: ['nextup'] },
            category: 'music',
            aliases: ['upcoming', 'nu'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: false, active: true, djPerm: null },
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
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing is playing right now.')],
            });
        }
        if (!player.queue.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.main).setDescription('Nothing is queued up.')],
            });
        }
        const lines = player.queue
            .slice(0, 10)
            .map(
                (track, index) =>
                    `**${index + 1}.** [${track.info.title}](${track.info.uri}) — ${track.info.author}`
            );
        const suffix = player.queue.length > 10 ? `\n…and ${player.queue.length - 10} more` : '';
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Next up')
                    .setDescription(`${lines.join('\n')}${suffix}`.slice(0, 4096)),
            ],
        });
    }
}
