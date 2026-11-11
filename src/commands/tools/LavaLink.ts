import type { Node } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

type NodeField = { name: string; value: string };

function percent(value: number): string {
    return `${(Math.round(value * 100) / 100).toFixed(2)}%`;
}

function nodeField(client: BootstrapClient, ctx: Context, node: Node): NodeField {
    const stats = node.stats;
    if (!stats) {
        return {
            name: tr(ctx, 'longtail:tools.nodeName'),
            value: `${node.name} (🔴)\n\`\`\`yaml\n${[
                tr(ctx, 'longtail:tools.offlinePlayer'),
                tr(ctx, 'longtail:tools.offlinePlayingPlayers'),
                tr(ctx, 'longtail:tools.offlineUptime'),
                tr(ctx, 'longtail:tools.offlineCores'),
                tr(ctx, 'longtail:tools.offlineMemory'),
                tr(ctx, 'longtail:tools.offlineSystemLoad'),
                tr(ctx, 'longtail:tools.offlineLavalinkLoad'),
            ].join('\n')}\`\`\``,
        };
    }

    const lines = [
        tr(ctx, 'longtail:tools.nodePlayer', { count: stats.players }),
        tr(ctx, 'longtail:tools.nodePlayingPlayers', { count: stats.playingPlayers }),
        tr(ctx, 'longtail:tools.nodeUptime', { uptime: client.utils.formatTime(stats.uptime) }),
        tr(ctx, 'longtail:tools.nodeCores', { cores: stats.cpu.cores }),
        tr(ctx, 'longtail:tools.nodeMemory', {
            used: client.utils.formatBytes(stats.memory.used),
            total: client.utils.formatBytes(stats.memory.reservable),
        }),
        tr(ctx, 'longtail:tools.nodeSystemLoad', { percent: percent(stats.cpu.systemLoad) }),
        tr(ctx, 'longtail:tools.nodeLavalinkLoad', { percent: percent(stats.cpu.lavalinkLoad) }),
    ];
    return {
        name: tr(ctx, 'longtail:tools.nodeName'),
        value: `${node.name} (🟢)\n\`\`\`yaml\n${lines.join('\n')}\`\`\``,
    };
}

export default class LavaLink extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'lavalink',
            description: {
                content: 'Shows the current Lavalink stats',
                examples: ['lavalink'],
                usage: 'lavalink',
            },
            category: 'info',
            aliases: ['ll'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const self = client.user;
        if (!self) return;

        const embed = client
            .embed()
            .setTitle(tr(ctx, 'longtail:tools.lavalinkTitle'))
            .setColor(client.color.main)
            .setThumbnail(self.avatarURL({}))
            .setTimestamp();

        for (const node of client.shoukaku.nodes.values()) {
            try {
                embed.addFields(nodeField(client, ctx, node));
            } catch (error) {
                client.logger.error(`[lavalink] could not render node ${node.name}: ${error}`);
            }
        }

        return await ctx.sendMessage({ embeds: [embed] });
    }
}
