import os from 'node:os';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Stats extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'stats',
            description: {
                content: 'Shows live bot statistics',
                usage: 'stats',
                examples: ['stats'],
            },
            category: 'info',
            aliases: ['botstats'],
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
        const memory = process.memoryUsage();
        const used = os.totalmem() - os.freemem();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:tools.statsTitle'))
                    .addFields(
                        {
                            name: tr(ctx, 'longtail:tools.statsGuilds'),
                            value: String(client.guilds.cache.size),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:tools.statsUsers'),
                            value: String(client.users.cache.size),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:tools.statsChannels'),
                            value: String(client.channels.cache.size),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:tools.statsCommands'),
                            value: String(client.commands.size),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:tools.statsActivePlayers'),
                            value: String(client.queue.size),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:tools.statsUptime'),
                            value: client.utils.formatTime(process.uptime()),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:tools.statsGatewayPing'),
                            value: tr(ctx, 'longtail:tools.statsPingValue', {
                                ping: Math.round(client.ws.ping),
                            }),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:tools.statsHeap'),
                            value: client.utils.formatBytes(memory.heapUsed),
                            inline: true,
                        },
                        {
                            name: tr(ctx, 'longtail:tools.statsSystemMemory'),
                            value: `${client.utils.formatBytes(used)} / ${client.utils.formatBytes(os.totalmem())}`,
                            inline: true,
                        }
                    ),
            ],
        });
    }
}
