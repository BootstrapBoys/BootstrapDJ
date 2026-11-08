import {
    ActionRowBuilder,
    ActivityType,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Message,
    MessageComponentInteraction,
} from 'discord.js';
import { LavalinkResponse, LoadType, Track } from 'shoukaku';

import config from '../config.js';
import { BootstrapClient, Context } from '../core/index.js';

type PagerAction = 'fast' | 'back' | 'stop' | 'next' | 'last';

type PagerPayload = {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
};

const PAGER_ACTIONS: ReadonlyArray<{
    id: PagerAction;
    emoji: string;
    style: ButtonStyle;
    edge: 'first' | 'last' | null;
}> = [
    { id: 'fast', emoji: '⏪', style: ButtonStyle.Primary, edge: 'first' },
    { id: 'back', emoji: '◀️', style: ButtonStyle.Primary, edge: 'first' },
    { id: 'stop', emoji: '⏹️', style: ButtonStyle.Danger, edge: null },
    { id: 'next', emoji: '▶️', style: ButtonStyle.Primary, edge: 'last' },
    { id: 'last', emoji: '⏩', style: ButtonStyle.Primary, edge: 'last' },
];

/**
 * Stateless formatting and presentation helpers shared by commands, events,
 * and the dashboard bridge. Keeping these free of player state makes them
 * cheap to call on every render.
 */
export class Utils {
    /** First playable track from any Lavalink load response. */
    public static firstTrack(response: LavalinkResponse | null): Track | null {
        if (!response) return null;
        switch (response.loadType) {
            case LoadType.TRACK:
                return response.data;
            case LoadType.SEARCH:
                return response.data[0] ?? null;
            case LoadType.PLAYLIST:
                return response.data.tracks[0] ?? null;
            default:
                return null;
        }
    }

    /** Compact clock: 9s, 1m 5s, 1h 2m, 1d 1h. */
    public static formatTime(milliseconds: number): string {
        const seconds = Math.max(0, milliseconds);
        const units = [
            { size: 86_400_000, suffix: 'd', next: 3_600_000, nextSuffix: 'h' },
            { size: 3_600_000, suffix: 'h', next: 60_000, nextSuffix: 'm' },
            { size: 60_000, suffix: 'm', next: 1000, nextSuffix: 's' },
        ] as const;
        for (const unit of units) {
            if (seconds >= unit.size) {
                const whole = Math.floor(seconds / unit.size);
                const remainder = Math.floor((seconds % unit.size) / unit.next);
                return `${whole}${unit.suffix} ${remainder}${unit.nextSuffix}`;
            }
        }
        return `${Math.floor(seconds / 1000)}s`;
    }

    /** Update account presence according to the configured status mode. */
    public static updateStatus(client: BootstrapClient, guildId?: string): void {
        if (!client.user) return;
        const showStatic = (): void => {
            client.user?.setPresence({
                activities: [{ name: config.botActivity, type: config.botActivityType }],
                status: config.botStatus,
            });
        };

        switch (config.botStatusMode) {
            case 'track': {
                if (guildId !== config.guildId) return;
                const player = client.queue.get(config.guildId);
                if (!player?.current) {
                    showStatic();
                    return;
                }
                client.user.setActivity({
                    name: `🎶 | ${player.current.info.title}`.slice(0, 128),
                    type: ActivityType.Listening,
                });
                return;
            }
            case 'count': {
                const showCount = (active: number): void => {
                    if (active <= 0) {
                        showStatic();
                        return;
                    }
                    client.user?.setActivity({
                        name: `music in ${active} server${active === 1 ? '' : 's'}`.slice(0, 128),
                        type: ActivityType.Listening,
                    });
                };
                if (client.shard) {
                    if (!client.isCoordinator) return;
                    void client.shard
                        .broadcastEval(candidate => {
                            const shard = candidate as unknown as BootstrapClient;
                            return [...shard.queue.values()].filter(player => Boolean(player.current)).length;
                        })
                        .then(counts => showCount(counts.reduce((total, value) => total + value, 0)))
                        .catch(() => {});
                    return;
                }
                showCount([...client.queue.values()].filter(player => Boolean(player.current)).length);
                return;
            }
            default:
                showStatic();
        }
    }

    /** Split an array into fixed-size groups without mutating the input. */
    public static chunk<T>(items: readonly T[], size: number): T[][] {
        const width = Math.max(1, Math.floor(size));
        return Array.from({ length: Math.ceil(items.length / width) }, (_, index) =>
            items.slice(index * width, (index + 1) * width)
        );
    }

    /** Human-readable byte count using binary units. */
    public static formatBytes(bytes: number, decimals: number = 2): string {
        if (bytes === 0) return '0 Bytes';
        const units = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const unitIndex = Math.min(
            units.length - 1,
            Math.max(0, Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)))
        );
        const digits = Math.max(0, decimals);
        const value = Number((bytes / 1024 ** unitIndex).toFixed(digits));
        return `${value} ${units[unitIndex]}`;
    }

    /** Render a fixed-width progress bar, or LIVE for an unknown duration. */
    public static progressBar(current: number, total: number, size: number = 20): string {
        if (!Number.isFinite(total) || total <= 0) return '🔴 LIVE';
        const width = Math.max(0, Math.floor(size));
        const ratio = Math.min(1, Math.max(0, current / total));
        const filled = Math.round(width * ratio);
        const percent = Math.round(ratio * 100);
        return `${'▓'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))} ${percent}%`;
    }

    /** Expire a component message after its collector ends. */
    public static scheduleDelete(client: BootstrapClient, message: Message, seconds?: number): void {
        const delay = seconds ?? client.config.deleteAfter;
        if (!delay || delay <= 0) return;
        const timer = setTimeout(() => {
            void message.delete().catch(() => {});
        }, delay * 1000);
        (timer as unknown as { unref?: () => void }).unref?.();
    }

    private static pagerPayload(pages: EmbedBuilder[], page: number): PagerPayload {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...PAGER_ACTIONS.map(action => {
                const disabled =
                    (action.edge === 'first' && page === 0) ||
                    (action.edge === 'last' && page === pages.length - 1);
                return new ButtonBuilder()
                    .setCustomId(action.id)
                    .setEmoji(action.emoji)
                    .setStyle(action.style)
                    .setDisabled(disabled);
            })
        );
        return { embeds: [pages[page]], components: [row] };
    }

    /** Display a set of embeds with author-scoped navigation buttons. */
    public static async paginate(ctx: Context, pages: EmbedBuilder[]): Promise<void> {
        if (!pages.length) return;
        if (pages.length === 1) {
            await ctx.sendMessage({ embeds: pages });
            return;
        }

        let page = 0;
        const authorId = ctx.author?.id;
        const message = await ctx.sendMessage(this.pagerPayload(pages, page));
        const collector = message.createMessageComponentCollector({
            filter: (interaction: MessageComponentInteraction) =>
                !authorId || interaction.user.id === authorId,
            time: 60_000,
        });

        collector.on('collect', async (interaction: MessageComponentInteraction) => {
            if (authorId && interaction.user.id !== authorId) {
                await interaction.reply({ content: `You can't use this button`, ephemeral: true });
                return;
            }
            if (interaction.customId === 'stop') {
                collector.stop();
                return;
            }
            switch (interaction.customId) {
                case 'fast':
                    page = 0;
                    break;
                case 'back':
                    page = Math.max(0, page - 1);
                    break;
                case 'next':
                    page = Math.min(pages.length - 1, page + 1);
                    break;
                case 'last':
                    page = pages.length - 1;
                    break;
            }
            await interaction.update(this.pagerPayload(pages, page));
        });

        collector.on('end', async () => {
            if (!ctx.ephemeral) await message.delete().catch(() => {});
        });
    }
}
