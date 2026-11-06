import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelSelectMenuInteraction,
    MentionableSelectMenuInteraction,
    PermissionFlagsBits,
    RoleSelectMenuInteraction,
    StringSelectMenuInteraction,
    TextChannel,
    UserSelectMenuInteraction,
} from 'discord.js';
import { Player } from 'shoukaku';

import { Song, toSaved } from '../../structures/Dispatcher.js';
import { BootstrapClient, Dispatcher, Event } from '../../structures/index.js';
import { loudnessOf, volumeForLoudness } from '../../utils/Loudness.js';
import { trackStart } from '../../utils/SetupSystem.js';

export default class TrackStart extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'trackStart',
        });
    }
    public async run(player: Player, track: Song, dispatcher: Dispatcher): Promise<void> {
        // Top up the lookahead before any early return below can skip it.
        void dispatcher.ensureLookahead().catch(() => {});
        const guild = this.client.guilds.cache.get(player.guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(dispatcher.channelId) as TextChannel;
        if (!channel) return;
        // Keep a durable recent-playback row: dispatcher history disappears on
        // restart, and /playrecent should survive that. Restored tracks were
        // already recorded before the restart.
        if (dispatcher.skipRecentRecording) {
            dispatcher.skipRecentRecording = false;
        } else if (!dispatcher.restoring) {
            void this.client.db
                .recordRecentTrack(
                guild.id,
                JSON.stringify(toSaved(track)),
                track.info.title,
                track.info.author,
                track.info.uri ?? null,
                track.info.requester?.id ?? null
            )
            .catch(() => {});
        }
        this.client.utils.updateStatus(this.client, guild.id);
        // Text announcements are opt-in through a dedicated channel, so the
        // existing now-playing message stays untouched for guilds that do not
        // configure one.
        const settings = await this.client.db.getGuildSettings(guild.id);
        if (settings.volumeautomatic === 'true') {
            const baseVolume = Number(settings.defaultvolume ?? 100);
            const targetLufs = Number(settings.loudnesstarget ?? -16);
            const fallbackVolume = Number.isFinite(baseVolume) && baseVolume >= 0 && baseVolume <= 200 ? baseVolume : 100;
            const uri = track.info.uri;
            if (uri && !track.info.isStream) {
                void loudnessOf(uri)
                    .then(result => {
                        if (dispatcher.current?.info.uri !== uri) return;
                        const volume = result
                            ? volumeForLoudness(result.lufs, Number.isFinite(targetLufs) ? targetLufs : -16, fallbackVolume)
                            : fallbackVolume;
                        player.setGlobalVolume(volume);
                        this.client.logger.info(
                            `[loudness] ${track.info.title}: ${result ? `${result.lufs.toFixed(1)} LUFS -> volume ${volume}` : `no sample -> volume ${volume}`}`
                        );
                    })
                    .catch(error => this.client.logger.warn(`[loudness] analysis failed: ${error}`));
            } else {
                player.setGlobalVolume(fallbackVolume);
            }
        }
        if (settings.announcechannel && settings.announce !== 'false') {
            const announceChannel = guild.channels.cache.get(settings.announcechannel);
            if (announceChannel?.isTextBased()) {
                const announce = await announceChannel
                    .send({
                        embeds: [
                            this.client
                                .embed()
                                .setColor(this.client.color.main)
                                .setDescription(
                                    `Now playing **${track.info.title}** by **${track.info.author}** in <#${dispatcher.voiceId ?? ''}>.`
                                ),
                        ],
                    })
                    .catch(() => null);
                if (announce) this.client.utils.scheduleDelete(this.client, announce);
            }
        }
        function buttonBuilder(): ActionRowBuilder<ButtonBuilder> {
            const previousButton = new ButtonBuilder()
                .setCustomId('previous')
                .setEmoji('⏪')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(dispatcher.previous ? false : true);
            const resumeButton = new ButtonBuilder()
                .setCustomId('resume')
                .setEmoji(player.paused ? '▶️' : '⏸️')
                .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary);
            const stopButton = new ButtonBuilder()
                .setCustomId('stop')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger);
            const skipButton = new ButtonBuilder()
                .setCustomId('skip')
                .setEmoji('⏩')
                .setStyle(ButtonStyle.Secondary);
            const loopButton = new ButtonBuilder()
                .setCustomId('loop')
                .setEmoji(dispatcher.loop === 'repeat' ? '🔂' : '🔁')
                .setStyle(dispatcher.loop !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary);

            return new ActionRowBuilder<ButtonBuilder>().addComponents(
                previousButton,
                resumeButton,
                stopButton,
                skipButton,
                loopButton
            );
        }
        const embed = this.client
            .embed()
            .setAuthor({
                name: 'Now Playing',
                iconURL:
                    this.client.config.icons[track.info.sourceName] ??
                    this.client.user?.displayAvatarURL({ extension: 'png' }),
            })
            .setColor(this.client.color.main)
            .setDescription(`**[${track.info.title}](${track.info.uri})**`)
            .setFooter({
                text: `Requested by ${track.info.requester.tag ?? 'unknown'}`,
                iconURL: track.info.requester.avatarURL({}) ?? undefined,
            })
            .setThumbnail(track.info.artworkUrl ?? null)
            .addFields(
                {
                    name: 'Duration',
                    value: track.info.isStream
                        ? 'LIVE'
                        : this.client.utils.formatTime(track.info.length),
                    inline: true,
                },
                { name: 'Author', value: track.info.author, inline: true }
            )
            .setTimestamp();
        let setup = await this.client.db.getSetup(guild.id);
        this.client.logger.debug(
            `[setup] trackStart guild=${guild.id} dispatcherChannel=${dispatcher.channelId} setupText=${setup?.textId ?? 'none'} setupMsg=${setup?.messageId ?? 'none'}`
        );
        if (setup && setup.textId) {
            const textChannel = guild.channels.cache.get(setup.textId) as TextChannel;
            const id = setup.messageId;
            if (!textChannel) {
                this.client.logger.warn(
                    `[setup] channel ${setup.textId} not found in cache — mock player not updated`
                );
                return;
            }
            if (channel && textChannel && channel.id === textChannel.id) {
                await trackStart(id, textChannel, dispatcher, track, this.client);
            } else {
                await trackStart(id, textChannel, dispatcher, track, this.client);
            }
        } else {
            const message = await channel.send({
                embeds: [embed],
                components: [buttonBuilder()],
            });
            dispatcher.nowPlayingMessage = message;
            const collector = message.createMessageComponentCollector({
                filter: async b => {
                    if (
                        b.guild.members.me?.voice.channel &&
                        b.guild.members.me?.voice.channelId === b.member.voice.channelId
                    )
                        return true;
                    else {
                        b.reply({
                            content: `You are not connected to <#${b.guild.members.me?.voice?.channelId ?? 'None'
                                }> to use this buttons.`,
                            ephemeral: true,
                        });
                        return false;
                    }
                },
                //time: track.info.isStream ? 86400000 : track.info.length,
            });

            collector.on('collect', async interaction => {
                if (!(await checkDj(this.client, interaction))) {
                    await interaction.reply({
                        content: `You need to have the DJ role to use this command.`,
                        ephemeral: true,
                    });
                    return;
                }
                switch (interaction.customId) {
                    case 'previous':
                        if (!dispatcher.previous) {
                            await interaction.reply({
                                content: `There is no previous song.`,
                                ephemeral: true,
                            });
                            return;
                        } else dispatcher.previousTrack();
                        if (message)
                            await message.edit({
                                embeds: [
                                    embed.setFooter({
                                        text: `Previous by ${interaction.user.tag}`,
                                        iconURL: interaction.user.avatarURL({}) ?? undefined,
                                    }),
                                ],
                                components: [buttonBuilder()],
                            });
                        break;
                    case 'resume':
                        dispatcher.pause();
                        if (message)
                            await message.edit({
                                embeds: [
                                    embed.setFooter({
                                        text: `${player.paused ? 'Paused' : 'Resumed'} by ${interaction.user.tag
                                            }`,
                                        iconURL: interaction.user.avatarURL({}) ?? undefined,
                                    }),
                                ],
                                components: [buttonBuilder()],
                            });
                        break;
                    case 'stop':
                        dispatcher.stop();
                        if (message)
                            await message.edit({
                                embeds: [
                                    embed.setFooter({
                                        text: `Stopped by ${interaction.user.tag}`,
                                        iconURL: interaction.user.avatarURL({}) ?? undefined,
                                    }),
                                ],
                                components: [],
                            });
                        break;
                    case 'skip':
                        if (!dispatcher.queue.length) {
                            await interaction.reply({
                                content: `There is no more song in the queue.`,
                                ephemeral: true,
                            });
                            return;
                        }
                        dispatcher.skip();
                        if (message)
                            await message.edit({
                                embeds: [
                                    embed.setFooter({
                                        text: `Skipped by ${interaction.user.tag}`,
                                        iconURL: interaction.user.avatarURL({}) ?? undefined,
                                    }),
                                ],
                                components: [],
                            });
                        break;
                    case 'loop':
                        switch (dispatcher.loop) {
                            case 'off':
                                dispatcher.loop = 'repeat';
                                if (message)
                                    await message.edit({
                                        embeds: [
                                            embed.setFooter({
                                                text: `Looping by ${interaction.user.tag}`,
                                                iconURL: interaction.user.avatarURL({}) ?? undefined,
                                            }),
                                        ],
                                        components: [buttonBuilder()],
                                    });
                                break;
                            case 'repeat':
                                dispatcher.loop = 'queue';
                                if (message)
                                    await message.edit({
                                        embeds: [
                                            embed.setFooter({
                                                text: `Looping Queue by ${interaction.user.tag}`,
                                                iconURL: interaction.user.avatarURL({}) ?? undefined,
                                            }),
                                        ],
                                        components: [buttonBuilder()],
                                    });
                                break;
                            case 'queue':
                                dispatcher.loop = 'off';
                                if (message)
                                    await message.edit({
                                        embeds: [
                                            embed.setFooter({
                                                text: `Looping Off by ${interaction.user.tag}`,
                                                iconURL: interaction.user.avatarURL({}) ?? undefined,
                                            }),
                                        ],
                                        components: [buttonBuilder()],
                                    });
                                break;
                        }
                        break;
                }
                await interaction.deferUpdate();
            });
        }
    }
}

export async function checkDj(
    client: BootstrapClient,
    interaction:
        | ButtonInteraction<'cached'>
        | StringSelectMenuInteraction<'cached'>
        | UserSelectMenuInteraction<'cached'>
        | RoleSelectMenuInteraction<'cached'>
        | MentionableSelectMenuInteraction<'cached'>
        | ChannelSelectMenuInteraction<'cached'>
): Promise<boolean> {
    const dj = await client.db.getDj(interaction.guildId);
    if (dj && dj.mode) {
        const djRole = await client.db.getRoles(interaction.guildId);
        if (!djRole) return false;
        const findDJRole = interaction.member.roles.cache.find((x: any) =>
            djRole.map((y: any) => y.roleId).includes(x.id)
        );
        if (!findDJRole) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return false;
            }
        } else return true;
    }
    return true;
}
/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
