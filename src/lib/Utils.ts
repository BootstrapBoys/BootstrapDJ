/* eslint-disable @typescript-eslint/typedef */
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

export class Utils {
    /** First playable track from any Lavalink load response. */
    public static firstTrack(res: LavalinkResponse | null): Track | null {
        if (!res) return null;
        if (res.loadType === LoadType.TRACK) return res.data;
        if (res.loadType === LoadType.SEARCH) return res.data[0] ?? null;
        if (res.loadType === LoadType.PLAYLIST) return res.data.tracks[0] ?? null;
        return null;
    }

    public static formatTime(ms: number): string {
        const minuteMs = 60 * 1000;
        const hourMs = 60 * minuteMs;
        const dayMs = 24 * hourMs;
        if (ms < minuteMs) {
            return `${Math.floor(ms / 1000)}s`;
        } else if (ms < hourMs) {
            return `${Math.floor(ms / minuteMs)}m ${Math.floor((ms % minuteMs) / 1000)}s`;
        } else if (ms < dayMs) {
            return `${Math.floor(ms / hourMs)}h ${Math.floor((ms % hourMs) / minuteMs)}m`;
        } else {
            return `${Math.floor(ms / dayMs)}d ${Math.floor((ms % dayMs) / hourMs)}h`;
        }
    }

    public static updateStatus(client: BootstrapClient, guildId?: string): void {
        if (!client.user) return;
        const staticPresence = (): void => {
            client.user?.setPresence({
                activities: [{ name: config.botActivity, type: config.botActivityType }],
                status: config.botStatus,
            });
        };

        if (config.botStatusMode === 'track') {
            if (guildId !== config.guildId) return;
            const player = client.queue.get(config.guildId);
            if (player?.current) {
                client.user.setActivity({
                    name: `🎶 | ${player.current.info.title}`.slice(0, 128),
                    type: ActivityType.Listening,
                });
            } else {
                staticPresence();
            }
            return;
        }

        if (config.botStatusMode === 'count') {
            const setCount = (active: number): void => {
                if (active > 0) {
                    client.user?.setActivity({
                        name: `music in ${active} server${active === 1 ? '' : 's'}`.slice(0, 128),
                        type: ActivityType.Listening,
                    });
                } else {
                    staticPresence();
                }
            };
            if (client.shard) {
                if (!client.isCoordinator) return;
                void client.shard
                    .broadcastEval(c => {
                        const shard = c as unknown as BootstrapClient;
                        return [...shard.queue.values()].filter(player => Boolean(player.current)).length;
                    })
                    .then(counts => setCount(counts.reduce((sum, value) => sum + value, 0)))
                    .catch(() => {});
                return;
            }
            const active = [...client.queue.values()].filter(player => Boolean(player.current)).length;
            setCount(active);
            return;
        }

        staticPresence();
    }

    public static chunk<T>(array: readonly T[], size: number): T[][] {
        const chunked: T[][] = [];
        for (let index = 0; index < array.length; index += size) {
            chunked.push(array.slice(index, index + size));
        }
        return chunked;
    }

    public static formatBytes(bytes: number, decimals = 2): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm: number = decimals < 0 ? 0 : decimals;
        const sizes: string[] = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i: number = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    public static progressBar(current: number, total: number, size = 20): string {
        // Livestreams report length 0; dividing by it produced Infinity and
        // '▓'.repeat(Infinity) threw RangeError inside /nowplaying.
        if (!Number.isFinite(total) || total <= 0) return '🔴 LIVE';
        const ratio = Math.min(Math.max(current / total, 0), 1);
        const filledSize = Math.round(size * ratio);
        const emptySize = Math.max(size - filledSize, 0);
        const percent = Math.round(ratio * 100);
        return `${'▓'.repeat(filledSize)}${'░'.repeat(emptySize)} ${percent}%`;
    }

    /**
     * Delete a message whose components kept it exempt from auto-delete, once
     * its collector has ended. Honours COMMAND_DELETE_AFTER (0 keeps it).
     */
    public static scheduleDelete(client: BootstrapClient, message: Message, seconds?: number): void {
        const timeout = seconds ?? client.config.deleteAfter;
        if (!timeout || timeout <= 0) return;
        const timer = setTimeout(() => {
            Promise.resolve(message.delete()).catch(() => {});
        }, timeout * 1000);
        (timer as unknown as { unref?: () => void }).unref?.();
    }

    public static async paginate(ctx: Context, pages: EmbedBuilder[]): Promise<void> {
        if (!pages.length) return;
        if (pages.length === 1) {
            await ctx.sendMessage({ embeds: pages });
            return;
        }

        let page = 0;
        const authorId = ctx.author?.id;
        const getPayload = (index: number): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } => {
            const first = index === 0;
            const last = index === pages.length - 1;
            const firstButton = new ButtonBuilder()
                .setCustomId('fast')
                .setEmoji('⏪')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(first);
            const backButton = new ButtonBuilder()
                .setCustomId('back')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(first);
            const nextButton = new ButtonBuilder()
                .setCustomId('next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(last);
            const lastButton = new ButtonBuilder()
                .setCustomId('last')
                .setEmoji('⏩')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(last);
            const stopButton = new ButtonBuilder()
                .setCustomId('stop')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger);
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                firstButton,
                backButton,
                stopButton,
                nextButton,
                lastButton
            );
            return { embeds: [pages[index]], components: [row] };
        };

        const msg = await ctx.sendMessage(getPayload(0));
        const collector = msg.createMessageComponentCollector({
            filter: (interaction: MessageComponentInteraction) =>
                !authorId || interaction.user.id === authorId,
            time: 60_000,
        });
        collector.on('collect', async (interaction: MessageComponentInteraction) => {
            if (authorId && interaction.user.id !== authorId) {
                await interaction.reply({ content: 'You can\'t use this button', ephemeral: true });
                return;
            }
            if (interaction.customId === 'stop') {
                collector.stop();
                return;
            }
            const last = pages.length - 1;
            if (interaction.customId === 'fast') page = 0;
            else if (interaction.customId === 'back') page = Math.max(0, page - 1);
            else if (interaction.customId === 'next') page = Math.min(last, page + 1);
            else if (interaction.customId === 'last') page = last;
            await interaction.update(getPayload(page));
        });
        collector.on('end', async () => {
            // Components kept the message exempt from armDelete(); clean up the
            // public paginator when its collector ends. Ephemeral messages are
            // private and cannot be deleted through the channel.
            if (!ctx.ephemeral) await msg.delete().catch(() => {});
        });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
