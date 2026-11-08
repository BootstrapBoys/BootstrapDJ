import { version } from 'discord.js';
import os from 'node:os';

import { BootstrapClient, Command, Context } from '../../core/index.js';

function hostFacts(client: BootstrapClient): Array<[string, string]> {
    const total = os.totalmem();
    const used = Math.max(0, total - os.freemem());
    const percent = Math.round((used / total) * 100);
    return [
        ['Operating System', `${os.type()} ${os.release()}`],
        ['Uptime', client.utils.formatTime(os.uptime())],
        ['Hostname', os.hostname()],
        ['CPU Architecture', `${os.arch()} (${os.cpus().length} cores)`],
        [
            'Memory Usage',
            `${client.utils.formatBytes(used)} / ${client.utils.formatBytes(total)} (${percent}%)`,
        ],
        ['Node Version', process.version],
        ['Discord Version', version],
        [
            'Connected to',
            `${client.guilds.cache.size} guilds, ${client.channels.cache.size} channels, and ${client.users.cache.size} users`,
        ],
        ['Total Commands', String(client.commands.size)],
    ];
}

export default class Info extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'info',
            description: {
                content: 'Information about the bot',
                examples: ['info'],
                usage: 'info',
            },
            category: 'info',
            aliases: ['botinfo', 'bi', 'about'],
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
        const body = hostFacts(client)
            .map(([label, value]) => `- **${label}**: ${value}`)
            .join('\n');
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Bot Information:\n${body}`),
            ],
        });
    }
}
