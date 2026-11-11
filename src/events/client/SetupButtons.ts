import { ButtonInteraction, EmbedBuilder, StringSelectMenuInteraction } from 'discord.js';

import { BootstrapClient, Dispatcher, Event } from '../../core/index.js';
import { translate } from '../../lib/i18n.js';
import { buttonReply } from '../../lib/SetupSystem.js';
import { checkDj } from '../player/TrackStart.js';

type SetupInteraction = ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>;
type ControlAction = (
    interaction: SetupInteraction,
    player: Dispatcher,
    messageId: string
) => Promise<void>;

const VOLUME_STEP = 10;
const SEEK_STEP_MS = 10_000;
const LOOP_MODES: readonly Dispatcher['loop'][] = ['off', 'queue', 'repeat'];

/**
 * Serves the persistent controls in the song-request channel and the compact
 * controls on a /nowplaying reply.
 *
 * Every click passes the same guards. The persisted setup message may be
 * re-rendered with the mock layout; a track-scoped reply must never be, or its
 * compact layout is lost. Skip/previous also let TrackStart own the next
 * render, so this handler only acknowledges them.
 */
export default class SetupButtons extends Event {
    private readonly actions: Readonly<Record<string, ControlAction>>;

    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'setupButtons' });
        this.actions = {
            LOW_VOL_BUT: (interaction, player, messageId) =>
                this.stepVolume(interaction, player, messageId, -VOLUME_STEP),
            HIGH_VOL_BUT: (interaction, player, messageId) =>
                this.stepVolume(interaction, player, messageId, VOLUME_STEP),
            PAUSE_BUT: (interaction, player, messageId) =>
                this.togglePause(interaction, player, messageId),
            SKIP_BUT: (interaction, player) => this.skip(interaction, player),
            STOP_BUT: (interaction, player) => this.stop(interaction, player),
            LOOP_BUT: (interaction, player, messageId) =>
                this.cycleLoop(interaction, player, messageId),
            SHUFFLE_BUT: (interaction, player) => this.shuffle(interaction, player),
            PREV_BUT: (interaction, player) => this.previous(interaction, player),
            REWIND_BUT: (interaction, player, messageId) =>
                this.seekBy(interaction, player, messageId, -SEEK_STEP_MS),
            FORWARD_BUT: (interaction, player, messageId) =>
                this.seekBy(interaction, player, messageId, SEEK_STEP_MS),
        };
    }

    private async deny(interaction: SetupInteraction, text: string): Promise<void> {
        await buttonReply(interaction, text, this.client.color.red);
    }

    private async confirm(interaction: SetupInteraction, text: string): Promise<void> {
        await buttonReply(interaction, text, this.client.color.main);
    }

    private async language(interaction: SetupInteraction): Promise<string> {
        if (!this.client.db) return this.client.config?.defaultLanguage ?? 'en-US';
        const settings = await this.client.db
            .getGuildSettings(interaction.guildId)
            .catch(() => ({}) as Record<string, string>);
        return settings.language ?? this.client.config?.defaultLanguage ?? 'en-US';
    }

    private async copy(
        interaction: SetupInteraction,
        key: string,
        variables: Record<string, string | number> = {}
    ): Promise<string> {
        return translate(`longtail:setup.${key}`, await this.language(interaction), variables);
    }

    /** True when this message is a command reply, not the persisted mock. */
    private async isTrackScoped(
        interaction: SetupInteraction,
        player: Dispatcher,
        messageId: string
    ): Promise<boolean> {
        const setup = await this.client.db.getSetup(interaction.guildId);
        return setup?.messageId !== messageId || player.hasTrackScopedNowPlayingMessage(messageId);
    }

    private nowPlayingEmbed(player: Dispatcher, language: string): EmbedBuilder | null {
        const current = player.current;
        if (!current) return null;
        const icon =
            this.client.config.icons[current.info.sourceName] ??
            this.client.user?.displayAvatarURL({ extension: 'png' });
        const duration = current.info.isStream
            ? 'LIVE'
            : this.client.utils.formatTime(current.info.length);
        return this.client
            .embed()
            .setAuthor({
                name: translate('longtail:setup.nowPlayingAuthor', language),
                iconURL: icon,
            })
            .setDescription(
                translate('longtail:setup.nowPlayingLine', language, {
                    title: current.info.title,
                    uri: current.info.uri ?? '',
                    duration,
                    requester: String(current.info.requester),
                })
            )
            .setImage(current.info.artworkUrl ?? null);
    }

    /** Footer feedback is safe only on the setup mock, never on a command reply. */
    private async editFeedback(
        interaction: SetupInteraction,
        player: Dispatcher,
        messageId: string,
        text: string
    ): Promise<void> {
        if (await this.isTrackScoped(interaction, player, messageId)) return;
        const embed = this.nowPlayingEmbed(player, await this.language(interaction));
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

    private async stepVolume(
        interaction: SetupInteraction,
        player: Dispatcher,
        messageId: string,
        delta: number
    ): Promise<void> {
        const volume = Math.max(0, Math.min(200, player.player.volume + delta));
        void player.player.setGlobalVolume(volume).catch(() => {});
        await this.confirm(interaction, await this.copy(interaction, 'volumeSet', { volume }));
        await this.editFeedback(
            interaction,
            player,
            messageId,
            await this.copy(interaction, 'volumeFooter', { volume })
        );
    }

    private async togglePause(
        interaction: SetupInteraction,
        player: Dispatcher,
        messageId: string
    ): Promise<void> {
        const wasPaused = player.player.paused;
        const state = await this.copy(interaction, wasPaused ? 'resumed' : 'paused');
        player.pause();
        await this.confirm(
            interaction,
            await this.copy(interaction, wasPaused ? 'resumedMusic' : 'pausedMusic')
        );
        await this.editFeedback(
            interaction,
            player,
            messageId,
            await this.copy(interaction, 'stateFooter', {
                state,
                user: interaction.member.displayName,
            })
        );
    }

    private async skip(interaction: SetupInteraction, player: Dispatcher): Promise<void> {
        if (!player.queue.length) {
            await this.confirm(interaction, await this.copy(interaction, 'skipEmpty'));
            return;
        }
        player.skip();
        await this.confirm(interaction, await this.copy(interaction, 'skipped'));
    }

    private async stop(interaction: SetupInteraction, player: Dispatcher): Promise<void> {
        const language = await this.language(interaction);
        const embed = this.nowPlayingEmbed(player, language);
        player.stop();
        await this.confirm(interaction, await this.copy(interaction, 'stopped'));
        if (!embed) return;
        await interaction.message
            .edit({
                embeds: [
                    embed
                        .setFooter({
                            text: await this.copy(interaction, 'stoppedFooter', {
                                user: interaction.member.displayName,
                            }),
                            iconURL: interaction.member.displayAvatarURL({}),
                        })
                        .setDescription(await this.copy(interaction, 'nothingPlaying'))
                        .setImage(this.client.config.links.img)
                        .setAuthor({
                            name: this.client.user?.username ?? 'BootstrapDJ',
                            iconURL: this.client.user?.displayAvatarURL({ extension: 'png' }),
                        }),
                ],
            })
            .catch(() => {});
    }

    private async cycleLoop(
        interaction: SetupInteraction,
        player: Dispatcher,
        messageId: string
    ): Promise<void> {
        const index = LOOP_MODES.indexOf(player.loop);
        const next = LOOP_MODES[(index + 1) % LOOP_MODES.length];
        player.setLoop(next);
        await this.confirm(
            interaction,
            await this.copy(interaction, 'loopSet', { mode: player.loop })
        );
        await this.editFeedback(
            interaction,
            player,
            messageId,
            await this.copy(interaction, 'loopFooter', {
                mode: player.loop,
                user: interaction.member.displayName,
            })
        );
    }

    private async shuffle(interaction: SetupInteraction, player: Dispatcher): Promise<void> {
        player.setShuffle();
        await this.confirm(interaction, await this.copy(interaction, 'shuffled'));
    }

    private async previous(interaction: SetupInteraction, player: Dispatcher): Promise<void> {
        if (!player.previous) {
            await this.confirm(interaction, await this.copy(interaction, 'noPrevious'));
            return;
        }
        await this.confirm(interaction, await this.copy(interaction, 'previous'));
        player.previousTrack();
    }

    private async seekBy(
        interaction: SetupInteraction,
        player: Dispatcher,
        messageId: string,
        delta: number
    ): Promise<void> {
        const target = player.player.position + delta;
        const current = player.current;
        if (!current) return;
        if (delta < 0 && target < 0) {
            await this.confirm(interaction, await this.copy(interaction, 'rewindLimit'));
            return;
        }
        if (delta > 0 && target > current.info.length) {
            await this.confirm(interaction, await this.copy(interaction, 'forwardLimit'));
            return;
        }
        player.seek(target);
        const action = await this.copy(interaction, delta < 0 ? 'rewound' : 'forwarded');
        await this.confirm(interaction, action);
        await this.editFeedback(
            interaction,
            player,
            messageId,
            await this.copy(interaction, 'seekFooter', {
                state: action,
                user: interaction.member.displayName,
            })
        );
    }

    public async run(interaction: SetupInteraction): Promise<void> {
        if (!interaction.deferred && !interaction.replied) {
            // Buttons only produce transient feedback; deferring publicly leaves
            // a visible "thinking" placeholder that editReply cannot remove.
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
        }
        if (!interaction.member.voice.channel) {
            return await this.deny(interaction, await this.copy(interaction, 'noVoice'));
        }

        const botMember = interaction.guild.members.me;
        if (
            botMember?.voice.channel &&
            botMember.voice.channelId !== interaction.member.voice.channelId
        ) {
            return await this.deny(
                interaction,
                await this.copy(interaction, 'wrongVoice', {
                    channel: String(botMember.voice.channel),
                })
            );
        }

        const player = this.client.queue.get(interaction.guildId);
        if (!player?.current) {
            return await this.deny(interaction, await this.copy(interaction, 'noPlaying'));
        }
        if (!interaction.isButton()) return;
        if (!(await checkDj(this.client, interaction))) {
            return await this.deny(interaction, await this.copy(interaction, 'djRequired'));
        }

        const action = this.actions[interaction.customId];
        if (!action) {
            await this.confirm(interaction, await this.copy(interaction, 'buttonUnavailable'));
            return;
        }
        await action(interaction, player, interaction.message.id);
    }
}
