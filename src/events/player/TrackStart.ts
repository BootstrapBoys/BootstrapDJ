import {
    ActionRowBuilder,
    type AnySelectMenuInteraction,
    BaseGuildTextChannel,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import type { Player } from 'shoukaku';

import { type Song, toSaved } from '../../core/Dispatcher.js';
import type { BootstrapClient, Dispatcher } from '../../core/index.js';
import { Event } from '../../core/index.js';
import { loudnessOf, volumeForLoudness } from '../../lib/Loudness.js';
import { translate } from '../../lib/i18n.js';
import { trackStart } from '../../lib/SetupSystem.js';
import { clearVoteSkip } from '../../commands/music/VoteSkip.js';

type DjInteraction = ButtonInteraction<'cached'> | AnySelectMenuInteraction<'cached'>;

const NOW_PLAYING_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_VOLUME = 100;
const DEFAULT_LOUDNESS = -16;

function copy(
    language: string,
    key: string,
    variables: Record<string, string | number> = {}
): string {
    return translate(`longtail:events.trackStart.${key}`, language, variables);
}

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

function nowPlayingEmbed(client: BootstrapClient, track: Song, language: string): EmbedBuilder {
    const requester = track.info.requester.tag ?? copy(language, 'unknownRequester');
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
            text: copy(language, 'requestedBy', { requester }),
            iconURL: track.info.requester.avatarURL({}) ?? undefined,
        })
        .setThumbnail(track.info.artworkUrl ?? null)
        .addFields(
            {
                name: copy(language, 'duration'),
                value: track.info.isStream
                    ? copy(language, 'live')
                    : client.utils.formatTime(track.info.length),
                inline: true,
            },
            { name: copy(language, 'author'), value: track.info.author, inline: true }
        )
        .setTimestamp();
}

async function recordRecentPlay(
    client: BootstrapClient,
    dispatcher: Dispatcher,
    track: Song
): Promise<void> {
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

    const configured = Number(settings.defaultvolume ?? DEFAULT_VOLUME);
    const fallback =
        Number.isFinite(configured) && configured >= 0 && configured <= 200
            ? configured
            : DEFAULT_VOLUME;
    const configuredTarget = Number(settings.loudnesstarget ?? DEFAULT_LOUDNESS);
    const target = Number.isFinite(configuredTarget) ? configuredTarget : DEFAULT_LOUDNESS;
    const uri = track.info.uri;
    if (!uri || track.info.isStream) {
        void player.setGlobalVolume(fallback);
        return;
    }

    void loudnessOf(uri)
        .then(result => {
            if (dispatcher.current?.info.uri !== uri) return;
            const volume = result ? volumeForLoudness(result.lufs, target, fallback) : fallback;
            void player.setGlobalVolume(volume);
            client.logger.info(
                `[loudness] ${track.info.title}: ${
                    result
                        ? `${result.lufs.toFixed(1)} LUFS -> volume ${volume}`
                        : `no sample -> volume ${volume}`
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
    settings: Record<string, string>,
    language: string
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
                        copy(language, 'announcement', {
                            title: track.info.title,
                            author: track.info.author,
                            channel: `<#${voiceId ?? ''}>`,
                        })
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
        clearVoteSkip(player.guildId);
        dispatcher.nowPlayingCollector?.stop('replaced');
        dispatcher.nowPlayingCollector = null;
        dispatcher.clearNowPlayingCommandMessages();
        void dispatcher.ensureLookahead().catch(() => {});

        const guild = this.client.guilds.cache.get(player.guildId);
        const channel = guild?.channels.cache.get(dispatcher.channelId);
        if (!guild || !channel?.isTextBased()) return;

        await recordRecentPlay(this.client, dispatcher, track);
        this.client.utils.updateStatus(this.client, guild.id);

        const settings = await this.client.db.getGuildSettings(guild.id);
        const language = settings.language ?? this.client.config.defaultLanguage;
        await applyAutomaticVolume(this.client, player, track, dispatcher, settings);
        await sendAnnouncement(
            this.client,
            guild.id,
            dispatcher.voiceId,
            track,
            settings,
            language
        );

        const embed = nowPlayingEmbed(this.client, track, language);
        const setup = await this.client.db.getSetup(guild.id);
        this.client.logger.debug(
            `[setup] trackStart guild=${guild.id} dispatcherChannel=${dispatcher.channelId} setupText=${
                setup?.textId ?? 'none'
            } setupMsg=${setup?.messageId ?? 'none'}`
        );

        if (setup?.textId) {
            const setupChannel = guild.channels.cache.get(setup.textId);
            if (!(setupChannel instanceof BaseGuildTextChannel)) {
                this.client.logger.warn(
                    `[setup] channel ${setup.textId} not found in cache — mock player not updated`
                );
                return;
            }
            await trackStart(
                setup.messageId,
                setupChannel,
                dispatcher,
                track,
                this.client,
                language
            );
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
                if (
                    me?.voice.channel &&
                    me.voice.channelId === interaction.member.voice.channelId
                ) {
                    return true;
                }
                await interaction
                    .reply({
                        content: copy(language, 'notConnected', {
                            channel: `<#${me?.voice?.channelId ?? 'None'}>`,
                        }),
                        ephemeral: true,
                    })
                    .catch(() => {});
                return false;
            },
        });
        dispatcher.nowPlayingCollector = collector;
        collector.on('end', () => {
            if (dispatcher.nowPlayingCollector === collector) {
                dispatcher.nowPlayingCollector = null;
            }
        });

        collector.on('collect', async interaction => {
            if (!(await checkDj(this.client, interaction))) {
                await interaction
                    .reply({
                        content: copy(language, 'djRequired'),
                        ephemeral: true,
                    })
                    .catch(() => {});
                return;
            }

            const setFooter = (text: string): void => {
                embed.setFooter({
                    text,
                    iconURL: interaction.user.avatarURL({}) ?? undefined,
                });
            };
            const editPanel = async (
                components: ActionRowBuilder<ButtonBuilder>[]
            ): Promise<void> => {
                await message.edit({ embeds: [embed], components }).catch(() => {});
            };

            switch (interaction.customId) {
                case 'previous':
                    if (!dispatcher.previous) {
                        await interaction
                            .reply({
                                content: copy(language, 'noPrevious'),
                                ephemeral: true,
                            })
                            .catch(() => {});
                        return;
                    }
                    dispatcher.previousTrack();
                    setFooter(copy(language, 'previousFooter', { user: interaction.user.tag }));
                    await editPanel([controlRow(dispatcher, player)]);
                    break;
                case 'resume':
                    dispatcher.pause();
                    setFooter(
                        copy(language, 'stateFooter', {
                            state: copy(language, player.paused ? 'paused' : 'resumed'),
                            user: interaction.user.tag,
                        })
                    );
                    await editPanel([controlRow(dispatcher, player)]);
                    break;
                case 'stop':
                    dispatcher.stop();
                    setFooter(copy(language, 'stoppedFooter', { user: interaction.user.tag }));
                    await editPanel([]);
                    break;
                case 'skip':
                    if (!dispatcher.queue.length) {
                        await interaction
                            .reply({
                                content: copy(language, 'noMoreSongs'),
                                ephemeral: true,
                            })
                            .catch(() => {});
                        return;
                    }
                    dispatcher.skip();
                    setFooter(copy(language, 'skippedFooter', { user: interaction.user.tag }));
                    await editPanel([]);
                    break;
                case 'loop': {
                    const modes: readonly Dispatcher['loop'][] = ['off', 'repeat', 'queue'];
                    const next = modes[(modes.indexOf(dispatcher.loop) + 1) % modes.length];
                    dispatcher.setLoop(next);
                    const label =
                        next === 'queue'
                            ? copy(language, 'loopQueue')
                            : next === 'repeat'
                              ? copy(language, 'loopRepeat')
                              : copy(language, 'loopOff');
                    setFooter(
                        copy(language, 'loopFooter', { mode: label, user: interaction.user.tag })
                    );
                    await editPanel([controlRow(dispatcher, player)]);
                    break;
                }
            }
            await interaction.deferUpdate().catch(() => {});
        });
    }
}

export async function checkDj(
    client: BootstrapClient,
    interaction: DjInteraction
): Promise<boolean> {
    const dj = await client.db.getDj(interaction.guildId);
    if (!dj?.mode) return true;
    const roles = await client.db.getRoles(interaction.guildId);
    if (!roles.length) return false;
    const hasDjRole = interaction.member.roles.cache.some(role =>
        roles.some(entry => entry.roleId === role.id)
    );
    if (hasDjRole) return true;
    return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
}
