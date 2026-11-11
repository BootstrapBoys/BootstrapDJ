import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

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
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const shard = client.shard;
        const ids = shard?.ids ?? [0];
        const values = ids.map(id => {
            const guilds = ids.length === 1 ? client.guilds.cache.size : null;
            return tr(ctx, 'longtail:tools.shardLine', {
                id,
                guilds: guilds ?? tr(ctx, 'longtail:tools.shardUnknownGuilds'),
            });
        });
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:tools.shardsTitle'))
                    .setDescription(
                        [
                            tr(ctx, 'longtail:tools.shardCount', { count: shard?.count ?? 1 }),
                            tr(ctx, 'longtail:tools.shardCurrent', {
                                ids: client.shard?.ids.join(', ') ?? '0',
                            }),
                            tr(ctx, 'longtail:tools.shardPing', {
                                ping: Math.round(client.ws.ping),
                            }),
                            '',
                            ...values,
                        ].join('\n')
                    ),
            ],
        });
    }
}
