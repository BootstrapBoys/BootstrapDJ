import os from 'node:os';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Stats extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'stats',
            description: { content: 'Shows live bot statistics', usage: 'stats', examples: ['stats'] },
            category: 'info',
            aliases: ['botstats'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
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
                    .setTitle('BootstrapDJ statistics')
                    .addFields(
                        { name: 'Guilds', value: String(client.guilds.cache.size), inline: true },
                        { name: 'Users', value: String(client.users.cache.size), inline: true },
                        { name: 'Channels', value: String(client.channels.cache.size), inline: true },
                        { name: 'Commands', value: String(client.commands.size), inline: true },
                        { name: 'Active players', value: String(client.queue.size), inline: true },
                        { name: 'Uptime', value: client.utils.formatTime(process.uptime()), inline: true },
                        { name: 'Gateway ping', value: `${Math.round(client.ws.ping)} ms`, inline: true },
                        { name: 'Heap', value: client.utils.formatBytes(memory.heapUsed), inline: true },
                        {
                            name: 'System memory',
                            value: `${client.utils.formatBytes(used)} / ${client.utils.formatBytes(os.totalmem())}`,
                            inline: true,
                        }
                    ),
            ],
        });
    }
}
