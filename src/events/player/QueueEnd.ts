import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Player } from 'shoukaku';

import { Song } from '../../structures/Dispatcher.js';
import { BootstrapClient, Dispatcher, Event } from '../../structures/index.js';

export default class QueueEnd extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'queueEnd',
        });
    }
    public async run(player: Player, track: Song, dispatcher: Dispatcher): Promise<void> {
        const guild = this.client.guilds.cache.get(dispatcher.guildId);
        if (!guild) return;
        // TrackEnd owns loop modes, autoplay, previous/current bookkeeping and
        // the status transition when current becomes null. QueueEnd fires
        // before TrackEnd requeues a loop iteration, so never treat that
        // transient empty queue as the end of the session.
        if (dispatcher.loop !== 'off') return;
        if (dispatcher.leaveOnEnd && !dispatcher.autoplay && !dispatcher.queue.length) {
            dispatcher.leaveOnEnd = false;
            dispatcher.destroy();
            return;
        }
        if (!dispatcher.autoplay && !dispatcher.queue.length) {
            const stay = await this.client.db.get_247(guild.id).catch(() => null);
            if (stay) return;
            const settings = await this.client.db.getGuildSettings(guild.id);
            // Re-check after the DB awaits: a loop iteration or a concurrent
            // enqueue may have populated the player while we were waiting.
            if (dispatcher.loop !== 'off' || dispatcher.current || dispatcher.autoplay || dispatcher.queue.length) return;
            const confirmSeconds = Number(settings.timeoutconfirmation ?? 0);
            const channel = guild.channels.cache.get(dispatcher.channelId);
            if (Number.isFinite(confirmSeconds) && confirmSeconds > 0 && channel?.isTextBased()) {
                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId('timeout-stay').setLabel('Still listening').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('timeout-leave').setLabel('Leave').setStyle(ButtonStyle.Secondary)
                );
                const prompt = await channel.send({
                    embeds: [
                        this.client
                            .embed()
                            .setColor(this.client.color.main)
                            .setDescription(`The queue is empty. I'll leave in ${confirmSeconds}s unless someone confirms.`)
                    ],
                    components: [row]
                });
                const collector = prompt.createMessageComponentCollector({ time: confirmSeconds * 1000, max: 1 });
                collector.on('collect', async interaction => {
                    await interaction.reply({ content: 'Staying connected.', ephemeral: true });
                    collector.stop('confirmed');
                });
                collector.on('end', async (_collected, reason) => {
                    await prompt.edit({ components: [] }).catch(() => null);
                    if (reason === 'time' && !dispatcher.queue.length && !dispatcher.autoplay) dispatcher.destroy();
                });
                return;
            }
            const seconds = Number(settings.timeoutplaying ?? 0);
            dispatcher.armIdleTimeout(Number.isFinite(seconds) ? seconds : 0);
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
