import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageActionRowComponentBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';

function getButtons(): ActionRowBuilder<ButtonBuilder>[] {
    let pausebut = new ButtonBuilder()
        .setCustomId(`PAUSE_BUT`)
        .setEmoji({ name: '⏸️' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let previousbut = new ButtonBuilder()
        .setCustomId(`PREV_BUT`)
        .setEmoji({ name: '⏮️' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let skipbut = new ButtonBuilder()
        .setCustomId(`SKIP_BUT`)
        .setEmoji({ name: '⏭️' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let highvolumebut = new ButtonBuilder()
        .setCustomId(`HIGH_VOL_BUT`)
        .setEmoji({ name: '🔊' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let lowvolumebut = new ButtonBuilder()
        .setCustomId(`LOW_VOL_BUT`)
        .setEmoji({ name: '🔉' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let forwardbut = new ButtonBuilder()
        .setCustomId(`FORWARD_BUT`)
        .setEmoji({ name: '⏩' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let stopbut = new ButtonBuilder()
        .setCustomId(`STOP_BUT`)
        .setEmoji({ name: '⏹️' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let loopbut = new ButtonBuilder()
        .setCustomId(`LOOP_BUT`)
        .setEmoji({ name: '🔁' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let shufflebut = new ButtonBuilder()
        .setCustomId(`SHUFFLE_BUT`)
        .setEmoji({ name: '🔀' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let rewindbut = new ButtonBuilder()
        .setCustomId(`REWIND_BUT`)
        .setEmoji({ name: '⏪' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false);
    let row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        lowvolumebut,
        previousbut,
        pausebut,
        skipbut,
        highvolumebut
    );
    let row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        rewindbut,
        loopbut,
        stopbut,
        shufflebut,
        forwardbut
    );
    return [row, row2];
}


/** Compact controls for command responses; the setup mock keeps getButtons(). */
function getNowPlayingButtons(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const previous = new ButtonBuilder()
        .setCustomId('PREV_BUT')
        .setEmoji({ name: '⏮️' })
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary);
    const playPause = new ButtonBuilder()
        .setCustomId('PAUSE_BUT')
        .setEmoji({ name: '⏯️' })
        .setLabel('Play/Pause')
        .setStyle(ButtonStyle.Secondary);
    const skip = new ButtonBuilder()
        .setCustomId('SKIP_BUT')
        .setEmoji({ name: '⏭️' })
        .setLabel('Skip')
        .setStyle(ButtonStyle.Secondary);
    return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(previous, playPause, skip)];
}

function getNowPlayingMenu(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('NOWPLAYING_MENU')
        .setPlaceholder('Playback controls')
        .addOptions(
            {
                label: 'Previous',
                value: 'PREV_BUT',
                emoji: { name: '⏮️' },
                description: 'Play the previous track',
            },
            {
                label: 'Play/Pause',
                value: 'PAUSE_BUT',
                emoji: { name: '⏯️' },
                description: 'Toggle playback',
            },
            {
                label: 'Skip',
                value: 'SKIP_BUT',
                emoji: { name: '⏭️' },
                description: 'Skip the current track',
            }
        );
    return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)];
}

function getNowPlayingControls(
    mode: 'buttons' | 'menu'
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    return mode === 'menu' ? getNowPlayingMenu() : getNowPlayingButtons();
}

export { getButtons, getNowPlayingControls };
