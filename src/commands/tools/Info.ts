import { version } from 'discord.js';
import os from 'node:os';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

function hostFacts(client: BootstrapClient, ctx: Context): Array<[string, string]> {
    const total = os.totalmem();
    const used = Math.max(0, total - os.freemem());
    const percent = Math.round((used / total) * 100);
    return [
        [tr(ctx, 'longtail:tools.infoOs'), `${os.type()} ${os.release()}`],
        [tr(ctx, 'longtail:tools.infoUptime'), client.utils.formatTime(os.uptime())],
        [tr(ctx, 'longtail:tools.infoHostname'), os.hostname()],
        [
            tr(ctx, 'longtail:tools.infoCpuArchitecture'),
            tr(ctx, 'longtail:tools.infoCpuValue', {
                arch: os.arch(),
                cores: os.cpus().length,
            }),
        ],
        [
            tr(ctx, 'longtail:tools.infoMemory'),
            tr(ctx, 'longtail:tools.infoMemoryValue', {
                used: client.utils.formatBytes(used),
                total: client.utils.formatBytes(total),
                percent,
            }),
        ],
        [tr(ctx, 'longtail:tools.infoNodeVersion'), process.version],
        [tr(ctx, 'longtail:tools.infoDiscordVersion'), version],
        [
            tr(ctx, 'longtail:tools.infoConnectedTo'),
            tr(ctx, 'longtail:tools.infoConnectedValue', {
                guilds: client.guilds.cache.size,
                channels: client.channels.cache.size,
                users: client.users.cache.size,
            }),
        ],
        [tr(ctx, 'longtail:tools.infoTotalCommands'), String(client.commands.size)],
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
        const body = hostFacts(client, ctx)
            .map(([label, value]) => tr(ctx, 'longtail:tools.infoLine', { label, value }))
            .join('\n');
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`${tr(ctx, 'longtail:tools.infoTitle')}\n${body}`),
            ],
        });
    }
}
