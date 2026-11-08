import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** One persistent control, described once and built on demand. */
interface ControlSpec {
    id: string;
    emoji: string;
    label?: string;
}

function buildControl(spec: ControlSpec): ButtonBuilder {
    const control = new ButtonBuilder()
        .setCustomId(spec.id)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(spec.emoji)
        .setDisabled(false);
    if (spec.label) control.setLabel(spec.label);
    return control;
}

function buildRow(specs: readonly ControlSpec[]): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(specs.map(buildControl));
}

/**
 * The ten-ID pad rendered inside the song-request channel. The order is part
 * of the public surface: row one mixes transport and volume, row two holds
 * seek, loop, stop, shuffle and forward.
 */
const MOCK_PAD: readonly (readonly ControlSpec[])[] = [
    [
        { id: 'LOW_VOL_BUT', emoji: '🔉' },
        { id: 'PREV_BUT', emoji: '⏮️' },
        { id: 'PAUSE_BUT', emoji: '⏸️' },
        { id: 'SKIP_BUT', emoji: '⏭️' },
        { id: 'HIGH_VOL_BUT', emoji: '🔊' },
    ],
    [
        { id: 'REWIND_BUT', emoji: '⏪' },
        { id: 'LOOP_BUT', emoji: '🔁' },
        { id: 'STOP_BUT', emoji: '⏹️' },
        { id: 'SHUFFLE_BUT', emoji: '🔀' },
        { id: 'FORWARD_BUT', emoji: '⏩' },
    ],
];

/** Compact three-button strip attached to a /nowplaying reply. */
const NOW_PLAYING_STRIP: readonly ControlSpec[] = [
    { id: 'PREV_BUT', emoji: '⏮️', label: 'Previous' },
    { id: 'PAUSE_BUT', emoji: '⏯️', label: 'Play/Pause' },
    { id: 'SKIP_BUT', emoji: '⏭️', label: 'Skip' },
];

/** Full mock-player control pad; only the song-request channel uses this. */
export function getButtons(): ActionRowBuilder<ButtonBuilder>[] {
    return MOCK_PAD.map(buildRow);
}

/**
 * Track-scoped controls for a command response. Labels keep the sparse row
 * readable; the setup mock must keep the unlabelled ten-ID pad above.
 */
export function getNowPlayingButtons(): ActionRowBuilder<ButtonBuilder>[] {
    return [buildRow(NOW_PLAYING_STRIP)];
}
