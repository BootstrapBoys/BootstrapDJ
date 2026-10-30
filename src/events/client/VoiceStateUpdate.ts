import { ChannelType } from 'discord.js';

import { BootstrapClient, Event } from '../../structures/index.js';

export default class VoiceStateUpdate extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'voiceStateUpdate',
        });
    }
    public async run(oldState: any, newState: any): Promise<void> {
        const guildId = newState.guild.id;
        const botId = this.client.user?.id;
        const me = newState.guild.members.me;
        if (!guildId || !botId || !me) return;
        const player = this.client.queue.get(guildId);
        if (!player) return;
        if (
            newState.guild.members.cache.get(botId) &&
            !newState.guild.members.cache.get(botId).voice.channelId
        ) {
            if (player) {
                return player.destroy();
            }
        }
        if (
            newState.id === botId &&
            newState.channelId &&
            newState.channel.type == ChannelType.GuildStageVoice &&
            me.voice.suppress
        ) {
            if (
                me.permissions.has(['Connect', 'Speak']) ||
                newState.channel.permissionsFor(me).has('MuteMembers')
            ) {
                await me.voice.setSuppressed(false).catch(() => { });
            }
        }
        if (newState.id == botId) return;
        const vc = newState.guild.channels.cache.get(
            player.node.manager.connections.get(newState.guild.id)?.channelId
        );
        if (
            newState.id === botId &&
            !newState.serverDeaf &&
            vc &&
            vc.permissionsFor(me).has('DeafenMembers')
        )
            await newState.setDeaf(true);
        if (newState.id === botId && newState.serverMute && !player.paused)
            player.pause();
        if (newState.id === botId && !newState.serverMute && player.paused)
            player.pause();

        let voiceChannel = newState.guild.channels.cache.get(
            player.node.manager.connections.get(newState.guild.id)?.channelId
        );

        if (newState.id === botId && newState.channelId === null) return;

        if (!voiceChannel) return;
        if (voiceChannel.members.filter((x: any) => !x.user.bot).size <= 0) {
            const server = await this.client.db.get_247(newState.guild.id);
            if (!server) {
                setTimeout(async () => {
                    const vc = player.node.manager.connections.get(newState.guild.id);
                    if (vc && !vc.channelId) return;
                    const playerVoiceChannel = newState.guild.channels.cache.get(vc?.channelId ?? '');
                    if (
                        player &&
                        playerVoiceChannel &&
                        playerVoiceChannel.members.filter((x: any) => !x.user.bot).size <= 0
                    ) {
                        if (player) {
                            player.destroy();
                        }
                    }
                }, 5000);
            } else {
                if (server) return;
                setTimeout(async () => {
                    const vc = player.node.manager.connections.get(newState.guild.id);
                    if (vc && !vc.channelId) return;
                    const playerVoiceChannel = newState.guild.channels.cache.get(vc?.channelId ?? '');
                    if (
                        player &&
                        playerVoiceChannel &&
                        playerVoiceChannel.members.filter((x: any) => !x.user.bot).size <= 0
                    ) {
                        if (player) {
                            player.destroy();
                        }
                    }
                }, 5000);
            }
        }
    }
}
