import { Message, PermissionFlagsBits, TextChannel } from 'discord.js';

import { BootstrapClient, Event } from '../../core/index.js';
import { resolvePlayer } from '../../lib/PlayerResolver.js';
import { oops, setupStart } from '../../lib/SetupSystem.js';

/** A plain request-channel message: resolve voice, then hand it to the search flow. */
export default class SetupSystem extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'setupSystem' });
    }

    private async reject(
        channel: TextChannel,
        message: Message<true>,
        text: string
    ): Promise<void> {
        await oops(channel, text);
        await message.delete().catch(() => {});
    }

    public async run(message: Message): Promise<void> {
        if (!message.inGuild()) return;
        const channel = message.channel;
        if (!(channel instanceof TextChannel)) return;

        const member = message.member;
        const me = message.guild.members.me;
        const botUser = this.client.user;
        if (!member || !me || !botUser) return;

        const voice = member.voice.channel;
        if (!voice) {
            return await this.reject(
                channel,
                message,
                'You are not connected to a voice channel to queue songs.'
            );
        }
        const voicePermissions = voice.permissionsFor(botUser);
        if (!voicePermissions?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
            return await this.reject(
                channel,
                message,
                `I don't have enough permission to connect/speak in <#${voice.id}>`
            );
        }
        if (me.voice.channel && me.voice.channelId !== member.voice.channelId) {
            return await this.reject(
                channel,
                message,
                `You are not connected to <#${me.voice.channelId}> to queue songs`
            );
        }

        if (!this.client.queue.hasNode) {
            return await this.reject(
                channel,
                message,
                'No Lavalink node is available right now. Please try again in a moment.'
            );
        }
        let player = await resolvePlayer(this.client, message.guildId, voice, channel);
        if (!player) {
            player = await this.client.queue.create(message.guild, voice, channel);
        }

        await setupStart(this.client, message.content, player, message);
        await message.delete().catch(() => {});
    }
}
