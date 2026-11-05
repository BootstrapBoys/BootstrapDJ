import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Shards extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'shards',
            description: { content: 'Shows shard status', usage: 'shards', examples: ['shards'] },
            category: 'info',
            aliases: ['shard'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const shard = client.shard;
        const ids = shard?.ids ?? [0];
        const values = ids.map(id => {
            const guilds = ids.length === 1 ? client.guilds.cache.size : null;
            return `Shard ${id}: ${guilds ?? 'unknown'} guilds`;
        });
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Shard status')
                    .setDescription(
                        [
                            `Shard count: **${shard?.count ?? 1}**`,
                            `Current shard: **${client.shard?.ids.join(', ') ?? '0'}**`,
                            `Gateway ping: **${Math.round(client.ws.ping)} ms**`,
                            '',
                            ...values,
                        ].join('\n')
                    ),
            ],
        });
    }
}
