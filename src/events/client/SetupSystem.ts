import { Message, PermissionsBitField, TextChannel } from 'discord.js';

import { BootstrapClient, Event } from '../../structures/index.js';
import { parseSetupRequest } from '../../utils/SetupRequest.js';
import { oops, setupStart } from '../../utils/SetupSystem.js';

export default class SetupSystem extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'setupSystem',
        });
    }
    public async run(message: Message): Promise<void> {
        if (!message.inGuild()) return;
        const channel = message.channel;
        if (!(channel instanceof TextChannel)) return;

        const member = message.member;
        const me = message.guild.members.me;
        const botUser = this.client.user;
        if (!member || !me || !botUser) return;

        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
            await oops(channel, `You are not connected to a voice channel to queue songs.`);
            await message.delete().catch(() => {});
            return;
        }

        if (
            !voiceChannel
                .permissionsFor(botUser)
                ?.has(PermissionsBitField.resolve(['Connect', 'Speak']))
        ) {
            await oops(
                channel,
                `I don't have enough permission to connect/speak in <#${voiceChannel.id}>`
            );
            await message.delete().catch(() => {});
            return;
        }

        if (me.voice.channel && me.voice.channelId !== member.voice.channelId) {
            await oops(
                channel,
                `You are not connected to <#${me.voice.channelId}> to queue songs`
            );
            await message.delete().catch(() => {});
            return;
        }

        let player = this.client.queue.get(message.guildId);
        if (!player) {
            if (!this.client.queue.hasNode) {
                await oops(
                    channel,
                    'No Lavalink node is available right now. Please try again in a moment.'
                );
                await message.delete().catch(() => {});
                return;
            }
            player = await this.client.queue.create(
                message.guild,
                voiceChannel,
                channel,
                this.client.shoukaku.options.nodeResolver(this.client.shoukaku.nodes)
            );
        }
        const guildData = await this.client.db.get(message.guildId).catch(() => null);
        const userPrefix = await this.client.db
            .getUserPrefix(message.guildId, message.author.id)
            .catch(() => null);
        const configured = guildData?.prefix ?? this.client.config.prefix;
        const prefixes = configured
            .split(',')
            .map(prefix => prefix.trim())
            .filter(Boolean);
        if (userPrefix) prefixes.push(userPrefix);
        const request = parseSetupRequest(message.content, prefixes, name =>
            this.client.aliases.get(name)
        );
        await setupStart(this.client, request.query, player, message, request.next);
        await message.delete().catch(() => {});
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
