import type { Node } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';

type NodeField = { name: string; value: string };

const OFFLINE_LINES = [
    'Player: 0',
    'Playing Players: 0',
    'Uptime: 0',
    'Cores: 0 Core(s)',
    'Memory Usage: 0/0',
    'System Load: 0%',
    'Lavalink Load: 0%',
];

function percent(value: number): string {
    return `${(Math.round(value * 100) / 100).toFixed(2)}%`;
}

function nodeField(client: BootstrapClient, node: Node): NodeField {
    const stats = node.stats;
    if (!stats) {
        return {
            name: 'Name:',
            value: `${node.name} (🔴)\n\`\`\`yaml\n${OFFLINE_LINES.join('\n')}\`\`\``,
        };
    }

    const lines = [
        `Player: ${stats.players}`,
        `Playing Players: ${stats.playingPlayers}`,
        `Uptime: ${client.utils.formatTime(stats.uptime)}`,
        `Cores: ${stats.cpu.cores} Core(s)`,
        `Memory Usage: ${client.utils.formatBytes(stats.memory.used)}/${client.utils.formatBytes(
            stats.memory.reservable
        )}`,
        `System Load: ${percent(stats.cpu.systemLoad)}`,
        `Lavalink Load: ${percent(stats.cpu.lavalinkLoad)}`,
    ];
    return {
        name: 'Name:',
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
            .setTitle('Lavalink Stats')
            .setColor(client.color.main)
            .setThumbnail(self.avatarURL({}))
            .setTimestamp();

        for (const node of client.shoukaku.nodes.values()) {
            try {
                embed.addFields(nodeField(client, node));
            } catch (error) {
                client.logger.error(`[lavalink] could not render node ${node.name}: ${error}`);
            }
        }

        return await ctx.sendMessage({ embeds: [embed] });
    }
}
