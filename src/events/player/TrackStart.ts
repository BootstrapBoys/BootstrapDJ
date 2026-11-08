import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelSelectMenuInteraction,
    EmbedBuilder,
    MentionableSelectMenuInteraction,
    PermissionFlagsBits,
    RoleSelectMenuInteraction,
    StringSelectMenuInteraction,
    TextChannel,
    UserSelectMenuInteraction,
} from 'discord.js';
import { Player } from 'shoukaku';

import { Song, toSaved } from '../../core/Dispatcher.js';
import { BootstrapClient, Dispatcher, Event } from '../../core/index.js';
import { loudnessOf, volumeForLoudness } from '../../lib/Loudness.js';
import { trackStart } from '../../lib/SetupSystem.js';

type DjInteraction =
    | ButtonInteraction<'cached'>
    | StringSelectMenuInteraction<'cached'>
    | UserSelectMenuInteraction<'cached'>
    | RoleSelectMenuInteraction<'cached'>
    | MentionableSelectMenuInteraction<'cached'>
    | ChannelSelectMenuInteraction<'cached'>;

const NOW_PLAYING_TTL_MS = 12 * 60 * 60 * 1000;

function controlRow(dispatcher: Dispatcher, player: Player): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('previous')
            .setEmoji('⏪')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!dispatcher.previous),
        new ButtonBuilder()
            .setCustomId('resume')
            .setEmoji(player.paused ? '▶️' : '⏸️')
            .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('skip').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('loop')
            .setEmoji(dispatcher.loop === 'repeat' ? '🔂' : '🔁')
            .setStyle(dispatcher.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success)
    );
}

function nowPlayingEmbed(client: BootstrapClient, track: Song): EmbedBuilder {
    return client
        .embed()
        .setAuthor({
            name: 'Now Playing',
            iconURL:
                client.config.icons[track.info.sourceName] ??
                client.user?.displayAvatarURL({ extension: 'png' }),
        })
        .setColor(client.color.main)
        .setDescription(`**[${track.info.title}](${track.info.uri})**`)
        .setFooter({
            text: `Requested by ${track.info.requester.tag ?? 'unknown'}`,
            iconURL: track.info.requester.avatarURL({}) ?? undefined,
        })
        .setThumbnail(track.info.artworkUrl ?? null)
        .addFields(
            {
                name: 'Duration',
                value: track.info.isStream ? 'LIVE' : client.utils.formatTime(track.info.length),
                inline: true,
            },
            { name: 'Author', value: track.info.author, inline: true }
        )
        .setTimestamp();
}

async function recordRecentPlay(client: BootstrapClient, dispatcher: Dispatcher, track: Song): Promise<void> {
    if (dispatcher.skipRecentRecording) {
        dispatcher.skipRecentRecording = false;
        return;
    }
    if (dispatcher.restoring) return;
    await client.db
        .recordRecentTrack(
            dispatcher.guildId,
            JSON.stringify(toSaved(track)),
            track.info.title,
            track.info.author,
            track.info.uri ?? null,
            track.info.requester?.id ?? null
        )
        .catch(() => {});
}

async function applyAutomaticVolume(
    client: BootstrapClient,
    player: Player,
    track: Song,
    dispatcher: Dispatcher,
    settings: Record<string, string>
): Promise<void> {
    if (settings.volumeautomatic !== 'true') return;
    const base = Number(settings.defaultvolume ?? 100);
    const fallback = Number.isFinite(base) && base >= 0 && base <= 200 ? base : 100;
    const target = Number(settings.loudnesstarget ?? -16);
    const uri = track.info.uri;
    if (!uri || track.info.isStream) {
        player.setGlobalVolume(fallback);
        return;
    }
    void loudnessOf(uri)
        .then(result => {
            if (dispatcher.current?.info.uri !== uri) return;
            const volume = result
                ? volumeForLoudness(result.lufs, Number.isFinite(target) ? target : -16, fallback)
                : fallback;
            player.setGlobalVolume(volume);
            client.logger.info(
                `[loudness] ${track.info.title}: ${
                    result ? `${result.lufs.toFixed(1)} LUFS -> volume ${volume}` : `no sample -> volume ${volume}`
                }`
            );
        })
        .catch(error => client.logger.warn(`[loudness] analysis failed: ${error}`));
}

async function sendAnnouncement(
    client: BootstrapClient,
    guildId: string,
    voiceId: string | null,
    track: Song,
    settings: Record<string, string>
): Promise<void> {
    if (!settings.announcechannel || settings.announce === 'false') return;
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(settings.announcechannel);
    if (!channel?.isTextBased()) return;
    const message = await channel
        .send({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        `Now playing **${track.info.title}** by **${track.info.author}** in <#${voiceId ?? ''}>.`
                    ),
            ],
        })
        .catch(() => null);
    if (message) client.utils.scheduleDelete(client, message);
}

export default class TrackStart extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'trackStart' });
    }

    public async run(player: Player, track: Song, dispatcher: Dispatcher): Promise<void> {
        dispatcher.nowPlayingCollector?.stop('replaced');
        dispatcher.nowPlayingCollector = null;
        dispatcher.clearNowPlayingCommandMessages();
        void dispatcher.ensureLookahead().catch(() => {});

        const guild = this.client.guilds.cache.get(player.guildId);
        const channel = guild?.channels.cache.get(dispatcher.channelId) as TextChannel | undefined;
        if (!guild || !channel) return;

        await recordRecentPlay(this.client, dispatcher, track);
        this.client.utils.updateStatus(this.client, guild.id);

        const settings = await this.client.db.getGuildSettings(guild.id);
        await applyAutomaticVolume(this.client, player, track, dispatcher, settings);
        await sendAnnouncement(this.client, guild.id, dispatcher.voiceId, track, settings);

        const embed = nowPlayingEmbed(this.client, track);
        const setup = await this.client.db.getSetup(guild.id);
        this.client.logger.debug(
            `[setup] trackStart guild=${guild.id} dispatcherChannel=${dispatcher.channelId} setupText=${setup?.textId ?? 'none'} setupMsg=${setup?.messageId ?? 'none'}`
        );

        if (setup?.textId) {
            const textChannel = guild.channels.cache.get(setup.textId) as TextChannel | undefined;
            if (!textChannel) {
                this.client.logger.warn(
                    `[setup] channel ${setup.textId} not found in cache — mock player not updated`
                );
                return;
            }
            await trackStart(setup.messageId, textChannel, dispatcher, track, this.client);
            return;
        }

        const message = await channel.send({
            embeds: [embed],
            components: [controlRow(dispatcher, player)],
        });
        dispatcher.nowPlayingMessage = message;

        const collector = message.createMessageComponentCollector({
            time: NOW_PLAYING_TTL_MS,
            filter: async interaction => {
                const me = interaction.guild.members.me;
                if (me?.voice.channel && me.voice.channelId === interaction.member.voice.channelId) return true;
                await interaction
                    .reply({
                        content: `You are not connected to <#${me?.voice?.channelId ?? 'None'}> to use these buttons.`,
                        ephemeral: true,
                    })
                    .catch(() => {});
                return false;
            },
        });
        dispatcher.nowPlayingCollector = collector;
        collector.on('end', () => {
            if (dispatcher.nowPlayingCollector === collector) dispatcher.nowPlayingCollector = null;
        });

        collector.on('collect', async interaction => {
            if (!(await checkDj(this.client, interaction))) {
                await interaction
                    .reply({ content: 'You need to have the DJ role to use this command.', ephemeral: true })
                    .catch(() => {});
                return;
            }

            const footer = (text: string): void => {
                embed.setFooter({
                    text,
                    iconURL: interaction.user.avatarURL({}) ?? undefined,
                });
            };
            const editPanel = async (components: ActionRowBuilder<ButtonBuilder>[]): Promise<void> => {
                await message.edit({ embeds: [embed], components }).catch(() => {});
            };

            switch (interaction.customId) {
                case 'previous':
                    if (!dispatcher.previous) {
                        await interaction
                            .reply({ content: 'There is no previous song.', ephemeral: true })
                            .catch(() => {});
                        return;
                    }
                    dispatcher.previousTrack();
                    footer(`Previous by ${interaction.user.tag}`);
                    await editPanel([controlRow(dispatcher, player)]);
                    break;
                case 'resume':
                    dispatcher.pause();
                    footer(`${player.paused ? 'Paused' : 'Resumed'} by ${interaction.user.tag}`);
                    await editPanel([controlRow(dispatcher, player)]);
                    break;
                case 'stop':
                    dispatcher.stop();
                    footer(`Stopped by ${interaction.user.tag}`);
                    await editPanel([]);
                    break;
                case 'skip':
                    if (!dispatcher.queue.length) {
                        await interaction
                            .reply({ content: 'There is no more song in the queue.', ephemeral: true })
                            .catch(() => {});
                        return;
                    }
                    dispatcher.skip();
                    footer(`Skipped by ${interaction.user.tag}`);
                    await editPanel([]);
                    break;
                case 'loop': {
                    const modes = ['off', 'repeat', 'queue'] as const;
                    dispatcher.loop = modes[(modes.indexOf(dispatcher.loop) + 1) % modes.length];
                    const label =
                        dispatcher.loop === 'queue'
                            ? 'Looping Queue'
                            : dispatcher.loop === 'repeat'
                              ? 'Looping'
                              : 'Looping Off';
                    footer(`${label} by ${interaction.user.tag}`);
                    await editPanel([controlRow(dispatcher, player)]);
                    break;
                }
            }
            await interaction.deferUpdate().catch(() => {});
        });
    }
}

export async function checkDj(client: BootstrapClient, interaction: DjInteraction): Promise<boolean> {
    const dj = await client.db.getDj(interaction.guildId);
    if (!dj?.mode) return true;
    const roles = await client.db.getRoles(interaction.guildId);
    if (!roles) return false;
    const hasDjRole = interaction.member.roles.cache.some(role => roles.some(entry => entry.roleId === role.id));
    if (hasDjRole) return true;
    return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}
