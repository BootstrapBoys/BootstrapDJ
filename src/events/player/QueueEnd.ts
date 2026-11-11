import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from 'discord.js';
import type { Player } from 'shoukaku';

import type { Song } from '../../core/Dispatcher.js';
import type { BootstrapClient, Dispatcher } from '../../core/index.js';
import { Event } from '../../core/index.js';
import { dashboardVoiceChannelIdFor } from '../../lib/DashboardVoice.js';
import { formatDuration } from '../../lib/NodeStatus.js';

export default class QueueEnd extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'queueEnd' });
    }

    private async confirmLeave(
        dispatcher: Dispatcher,
        channel: TextChannel,
        seconds: number
    ): Promise<void> {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('timeout-stay')
                .setLabel('Still listening')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('timeout-leave')
                .setLabel('Leave')
                .setStyle(ButtonStyle.Secondary)
        );
        const prompt = await channel.send({
            embeds: [
                this.client
                    .embed()
                    .setColor(this.client.color.main)
                    .setDescription(
                        `The queue is empty. I'll leave in ${formatDuration(
                            seconds * 1000
                        )} unless someone confirms.`
                    ),
            ],
            components: [row],
        });
        dispatcher.clearQueueEmptyPrompt();
        dispatcher.queueEmptyPrompt = prompt;

        const collector = prompt.createMessageComponentCollector({
            time: seconds * 1000,
            max: 1,
        });
        dispatcher.queueEmptyCollector = collector;
        collector.on('collect', async interaction => {
            if (interaction.customId === 'timeout-leave') {
                await interaction.reply({
                    content: 'Leaving the voice channel.',
                    ephemeral: true,
                });
                collector.stop('leave');
                dispatcher.destroy();
                return;
            }
            await interaction.reply({ content: 'Staying connected.', ephemeral: true });
            collector.stop('confirmed');
        });
        collector.on('end', async (_collected, reason) => {
            if (dispatcher.queueEmptyCollector === collector) {
                dispatcher.queueEmptyCollector = null;
            }
            if (dispatcher.queueEmptyPrompt === prompt) dispatcher.queueEmptyPrompt = null;
            await prompt.delete().catch(() => null);
            if (reason === 'time' && !dispatcher.queue.length && !dispatcher.autoplay) {
                dispatcher.destroy();
            }
        });
    }

    public async run(_player: Player, _track: Song, dispatcher: Dispatcher): Promise<void> {
        const guild = this.client.guilds.cache.get(dispatcher.guildId);
        if (!guild || dispatcher.loop !== 'off') return;

        if (dispatcher.leaveOnEnd && !dispatcher.autoplay && !dispatcher.queue.length) {
            dispatcher.leaveOnEnd = false;
            dispatcher.destroy();
            return;
        }
        if (dispatcher.autoplay || dispatcher.queue.length) return;

        // The dashboard voice channel is a listening surface, not a 24/7
        // channel. Once the queue is empty, leave immediately instead of
        // waiting for the normal confirmation/idle timeout.
        const dashboardChannel = dashboardVoiceChannelIdFor(this.client, dispatcher);
        const dashboardVoiceId = guild.members?.me?.voice.channelId ?? dispatcher.voiceId;
        if (dashboardChannel && dashboardVoiceId === dashboardChannel) {
            dispatcher.destroy();
            return;
        }

        const stay = await this.client.db.get_247(guild.id).catch(() => null);
        if (stay) return;

        const settings = await this.client.db.getGuildSettings(guild.id);
        if (
            dispatcher.loop !== 'off' ||
            dispatcher.current ||
            dispatcher.autoplay ||
            dispatcher.queue.length
        ) {
            return;
        }

        const confirmSeconds = Number(settings.timeoutconfirmation ?? 0);
        const channel = guild.channels.cache.get(dispatcher.channelId);
        if (
            Number.isFinite(confirmSeconds) &&
            confirmSeconds > 0 &&
            channel instanceof TextChannel
        ) {
            await this.confirmLeave(dispatcher, channel, confirmSeconds);
            return;
        }

        const idleSeconds = Number(settings.timeoutplaying ?? 0);
        dispatcher.armIdleTimeout(Number.isFinite(idleSeconds) ? idleSeconds : 0);
    }
}
