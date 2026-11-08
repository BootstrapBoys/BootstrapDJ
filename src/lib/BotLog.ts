import { TextChannel } from 'discord.js';

import { BootstrapClient } from '../core/index.js';

/** Severity → embed stripe colour for the configured log channel. */
const STRIPE: Record<string, number> = {
    error: 0xff0000,
    warn: 0xffff00,
    info: 0x00ff00,
    success: 0x00ff00,
};

/**
 * Post a status line to the audit channel.
 *
 * The channel is optional at runtime: installations without LOG_CHANNEL_ID,
 * without a cached channel, or without Send Message permission simply skip the
 * notice. Logging must never take a command down.
 */
export default class BotLog {
    public static send(client: BootstrapClient, message: string, type: string): void {
        const channelId = client?.config.logChannelId;
        const channels = client?.channels?.cache;
        if (!channelId || !channels) return;

        const channel = channels.get(channelId);
        if (!(channel instanceof TextChannel) || !channel.isSendable()) return;

        const embed = client
            .embed()
            .setColor(STRIPE[type] ?? 0x000000)
            .setDescription(message)
            .setTimestamp();
        void channel.send({ embeds: [embed] }).catch(() => {});
    }
}
