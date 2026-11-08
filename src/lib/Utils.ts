import {
    ActionRowBuilder,
    ActivityType,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    type Message,
    type MessageComponentInteraction,
} from 'discord.js';
import { type LavalinkResponse, LoadType, type Track } from 'shoukaku';

import config from '../config.js';
import type { BootstrapClient, Context } from '../core/index.js';

type PagerAction = 'fast' | 'back' | 'stop' | 'next' | 'last';

interface PagerButton {
    id: PagerAction;
    emoji: string;
    style: ButtonStyle;
    edge: 'first' | 'last' | null;
}

interface PagerPayload {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
}

const PAGER_BUTTONS: readonly PagerButton[] = [
    { id: 'fast', emoji: '⏪', style: ButtonStyle.Primary, edge: 'first' },
    { id: 'back', emoji: '◀️', style: ButtonStyle.Primary, edge: 'first' },
    { id: 'stop', emoji: '⏹️', style: ButtonStyle.Danger, edge: null },
    { id: 'next', emoji: '▶️', style: ButtonStyle.Primary, edge: 'last' },
    { id: 'last', emoji: '⏩', style: ButtonStyle.Primary, edge: 'last' },
];

const CLOCK_UNITS: ReadonlyArray<{
    span: number;
    suffix: string;
    remainderSpan: number;
    remainderSuffix: string;
}> = [
    { span: 86_400_000, suffix: 'd', remainderSpan: 3_600_000, remainderSuffix: 'h' },
    { span: 3_600_000, suffix: 'h', remainderSpan: 60_000, remainderSuffix: 'm' },
    { span: 60_000, suffix: 'm', remainderSpan: 1000, remainderSuffix: 's' },
];

function isPagerAction(value: string): value is PagerAction {
    return PAGER_BUTTONS.some(button => button.id === value);
}

function pageAfter(action: PagerAction, current: number, total: number): number {
    switch (action) {
        case 'fast':
            return 0;
        case 'back':
            return Math.max(0, current - 1);
        case 'next':
            return Math.min(total - 1, current + 1);
        case 'last':
            return total - 1;
        default:
            return current;
    }
}

/**
 * Formatting and presentation helpers with no player state of their own, so
 * commands, events and the dashboard can call them during a render.
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
        const elapsed = Math.max(0, milliseconds);
        for (const unit of CLOCK_UNITS) {
            if (elapsed < unit.span) continue;
            const primary = Math.floor(elapsed / unit.span);
            const remainder = Math.floor((elapsed % unit.span) / unit.remainderSpan);
            return `${primary}${unit.suffix} ${remainder}${unit.remainderSuffix}`;
        }
        return `${Math.floor(elapsed / 1000)}s`;
    }

    private static activePlayers(players: ReadonlyMap<string, { current: unknown }>): number {
        let active = 0;
        for (const player of players.values()) {
            if (player.current) active += 1;
        }
        return active;
    }

    /** Update account presence according to the configured status mode. */
    public static updateStatus(client: BootstrapClient, guildId?: string): void {
        const user = client.user;
        if (!user) return;

        const showStatic = (): void => {
            user.setPresence({
                activities: [{ name: config.botActivity, type: config.botActivityType }],
                status: config.botStatus,
            });
        };

        if (config.botStatusMode === 'track') {
            if (guildId !== config.guildId) return;
            const player = client.queue.get(config.guildId);
            if (!player?.current) {
                showStatic();
                return;
            }
            user.setActivity({
                name: `🎶 | ${player.current.info.title}`.slice(0, 128),
                type: ActivityType.Listening,
            });
            return;
        }

        if (config.botStatusMode !== 'count') {
            showStatic();
            return;
        }

        const showCount = (active: number): void => {
            if (active <= 0) {
                showStatic();
                return;
            }
            user.setActivity({
                name: `music in ${active} server${active === 1 ? '' : 's'}`.slice(0, 128),
                type: ActivityType.Listening,
            });
        };

        if (!client.shard) {
            showCount(Utils.activePlayers(client.queue));
            return;
        }
        if (!client.isCoordinator) return;

        void client.shard
            .broadcastEval(candidate => {
                const queue = Reflect.get(candidate, 'queue');
                if (!(queue instanceof Map)) return 0;
                let active = 0;
                for (const player of queue.values()) {
                    if (
                        player !== null &&
                        typeof player === 'object' &&
                        'current' in player &&
                        player.current
                    ) {
                        active += 1;
                    }
                }
                return active;
            })
            .then(counts => showCount(counts.reduce((total, value) => total + value, 0)))
            .catch(() => {});
    }

    /** Split an array into fixed-size groups without mutating the input. */
    public static chunk<T>(items: readonly T[], size: number): T[][] {
        const width = Math.max(1, Math.floor(size));
        const groups: T[][] = [];
        for (let offset = 0; offset < items.length; offset += width) {
            groups.push(items.slice(offset, offset + width));
        }
        return groups;
    }

    /** Human-readable byte count using binary units. */
    public static formatBytes(bytes: number, decimals: number = 2): string {
        if (bytes === 0) return '0 Bytes';
        const units = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const magnitude = Math.abs(bytes);
        const unitIndex = Math.min(
            units.length - 1,
            Math.max(0, Math.floor(Math.log(magnitude) / Math.log(1024)))
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
    public static scheduleDelete(
        client: BootstrapClient,
        message: Message,
        seconds?: number
    ): void {
        const delay = seconds ?? client.config.deleteAfter;
        if (!delay || delay <= 0) return;
        const timer = setTimeout(() => {
            void message.delete().catch(() => {});
        }, delay * 1000);
        timer.unref();
    }

    private static pagerPayload(pages: EmbedBuilder[], page: number): PagerPayload {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...PAGER_BUTTONS.map(button => {
                const atEdge =
                    (button.edge === 'first' && page === 0) ||
                    (button.edge === 'last' && page === pages.length - 1);
                return new ButtonBuilder()
                    .setCustomId(button.id)
                    .setEmoji(button.emoji)
                    .setStyle(button.style)
                    .setDisabled(atEdge);
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
        const message = await ctx.sendMessage(Utils.pagerPayload(pages, page));
        const collector = message.createMessageComponentCollector({
            filter: (interaction: MessageComponentInteraction) =>
                !authorId || interaction.user.id === authorId,
            time: 60_000,
        });

        collector.on('collect', async (interaction: MessageComponentInteraction) => {
            if (interaction.customId === 'stop') {
                collector.stop('closed');
                return;
            }
            if (!isPagerAction(interaction.customId)) return;
            page = pageAfter(interaction.customId, page, pages.length);
            await interaction.update(Utils.pagerPayload(pages, page));
        });

        collector.on('end', async () => {
            if (!ctx.ephemeral) await message.delete().catch(() => {});
        });
    }
}
