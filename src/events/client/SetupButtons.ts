import { ButtonInteraction, EmbedBuilder, StringSelectMenuInteraction } from 'discord.js';

import { BootstrapClient, Dispatcher, Event } from '../../core/index.js';
import { buttonReply } from '../../lib/SetupSystem.js';
import { checkDj } from '../player/TrackStart.js';

type SetupInteraction = ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>;

const VOLUME_STEP = 10;
const SEEK_STEP_MS = 10_000;

/**
 * Handles the persistent control buttons on the song-request mock player.
 *
 * Every click is checked against voice state, DJ permission, and the message
 * identity. The mock is long-lived; a /nowplaying reply must not be rewritten
 * with the setup layout, and skip/previous must not race TrackStart's render.
 */
export default class SetupButtons extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'setupButtons' });
    }

    private async deny(interaction: SetupInteraction, text: string): Promise<void> {
        await buttonReply(interaction, text, this.client.color.red);
    }

    private async confirm(interaction: SetupInteraction, text: string): Promise<void> {
        await buttonReply(interaction, text, this.client.color.main);
    }

    private async isTrackScoped(
        interaction: SetupInteraction,
        player: Dispatcher,
        messageId: string
    ): Promise<boolean> {
        const setup = await this.client.db.getSetup(interaction.guildId);
        return setup?.messageId !== messageId || player.hasTrackScopedNowPlayingMessage(messageId);
    }

    private nowPlayingEmbed(player: Dispatcher): EmbedBuilder | null {
        const current = player.current;
        if (!current) return null;
        const sourceIcon =
            this.client.config.icons[current.info.sourceName] ??
            this.client.user?.displayAvatarURL({ extension: 'png' });
        return this.client
            .embed()
            .setAuthor({ name: 'Now Playing', iconURL: sourceIcon })
            .setDescription(
                `[${current.info.title}](${current.info.uri}) - ${
                    current.info.isStream ? 'LIVE' : this.client.utils.formatTime(current.info.length)
                } - Requested by ${current.info.requester}`
            )
            .setImage(current.info.artworkUrl ?? null);
    }

    private async editFeedback(
        interaction: SetupInteraction,
        player: Dispatcher,
        messageId: string,
        text: string
    ): Promise<void> {
        if (await this.isTrackScoped(interaction, player, messageId)) return;
        const embed = this.nowPlayingEmbed(player);
        if (!embed) return;
        await interaction.message
            .edit({
                embeds: [
                    embed.setFooter({
                        text,
                        iconURL: interaction.member.displayAvatarURL({}),
                    }),
                ],
            })
            .catch(() => {});
    }

    public async run(interaction: SetupInteraction): Promise<void> {
        if (!interaction.replied) await interaction.deferReply().catch(() => {});
        if (!interaction.member.voice.channel) {
            return await this.deny(interaction, 'You are not connected to a voice channel to use this button.');
        }

        const botMember = interaction.guild.members.me;
        if (botMember?.voice.channel && botMember.voice.channelId !== interaction.member.voice.channelId) {
            return await this.deny(
                interaction,
                `You are not connected to ${botMember.voice.channel} to use these buttons.`
            );
        }

        const player = this.client.queue.get(interaction.guildId);
        if (!player?.current) {
            return await this.deny(interaction, 'There is no music playing in this server.');
        }
        if (!interaction.isButton()) return;
        if (!(await checkDj(this.client, interaction))) {
            return await this.deny(interaction, 'You need to have the DJ role to use this command.');
        }

        const messageId = interaction.message.id;
        switch (interaction.customId) {
            case 'LOW_VOL_BUT':
            case 'HIGH_VOL_BUT': {
                const delta = interaction.customId === 'LOW_VOL_BUT' ? -VOLUME_STEP : VOLUME_STEP;
                const volume = Math.max(0, Math.min(200, player.player.volume + delta));
                void player.player.setGlobalVolume(volume).catch(() => {});
                await this.confirm(interaction, `Volume set to ${volume}%`);
                await this.editFeedback(interaction, player, messageId, `Volume: ${volume}%`);
                return;
            }
            case 'PAUSE_BUT': {
                const nextState = player.player.paused ? 'Resumed' : 'Paused';
                player.pause();
                await this.confirm(interaction, `${nextState} the music.`);
                if (!(await this.isTrackScoped(interaction, player, messageId))) {
                    await this.editFeedback(
                        interaction,
                        player,
                        messageId,
                        `${nextState} by ${interaction.member.displayName}`
                    );
                }
                return;
            }
            case 'SKIP_BUT':
                if (!player.queue.length) return await this.confirm(interaction, 'There is no music to skip.');
                player.skip();
                await this.confirm(interaction, 'Skipped the music.');
                return;
            case 'STOP_BUT': {
                const embed = this.nowPlayingEmbed(player);
                player.stop();
                await this.confirm(interaction, 'Stopped the music.');
                if (embed) {
                    await interaction.message
                        .edit({
                            embeds: [
                                embed
                                    .setFooter({
                                        text: `Stopped by ${interaction.member.displayName}`,
                                        iconURL: interaction.member.displayAvatarURL({}),
                                    })
                                    .setDescription('Nothing playing right now')
                                    .setImage(this.client.config.links.img)
                                    .setAuthor({
                                        name: this.client.user?.username ?? 'BootstrapDJ',
                                        iconURL: this.client.user?.displayAvatarURL({ extension: 'png' }),
                                    }),
                            ],
                        })
                        .catch(() => {});
                }
                return;
            }
            case 'LOOP_BUT': {
                const modes = ['off', 'queue', 'repeat'] as const;
                const nextMode = modes[(modes.indexOf(player.loop) + 1) % modes.length];
                player.setLoop(nextMode);
                await this.confirm(interaction, `Loop set to ${player.loop}.`);
                await this.editFeedback(
                    interaction,
                    player,
                    messageId,
                    `Loop set to ${player.loop} by ${interaction.member.displayName}`
                );
                return;
            }
            case 'SHUFFLE_BUT':
                player.setShuffle();
                await this.confirm(interaction, 'Shuffled the queue.');
                return;
            case 'PREV_BUT':
                if (!player.previous) return await this.confirm(interaction, 'There is no previous track.');
                await this.confirm(interaction, 'Playing the previous track.');
                player.previousTrack();
                return;
            case 'REWIND_BUT': {
                const position = player.player.position - SEEK_STEP_MS;
                if (position < 0) {
                    return await this.confirm(
                        interaction,
                        'You cannot rewind the music more than the length of the song.'
                    );
                }
                player.seek(position);
                await this.confirm(interaction, 'Rewound the music.');
                await this.editFeedback(
                    interaction,
                    player,
                    messageId,
                    `Rewound by ${interaction.member.displayName}`
                );
                return;
            }
            case 'FORWARD_BUT': {
                const position = player.player.position + SEEK_STEP_MS;
                if (position > player.current.info.length) {
                    return await this.confirm(
                        interaction,
                        'You cannot forward the music more than the length of the song.'
                    );
                }
                player.seek(position);
                await this.confirm(interaction, 'Forwarded the music.');
                await this.editFeedback(
                    interaction,
                    player,
                    messageId,
                    `Forwarded by ${interaction.member.displayName}`
                );
                return;
            }
            default:
                await this.confirm(interaction, 'This button is not available.');
        }
    }
}
