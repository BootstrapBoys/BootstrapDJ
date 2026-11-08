import type Dispatcher from '../core/Dispatcher.js';

/** Numeric knob a filter exposes in the dashboard (pitch, rate, speed). */
export interface FilterRange {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly fallback: number;
}

/**
 * Presentation metadata for one dashboard filter. Transport changes live in
 * `EFFECTS` so the catalogue can be serialised to the browser without leaking
 * Lavalink calls into the settings payload.
 */
export interface FilterDef {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly value?: FilterRange;
    /** Label the bot stores in `player.filters`, which users see in commands. */
    readonly activeName?: string;
    /** Filters sharing a group are mutually exclusive on the same track. */
    readonly group?: string;
}

interface Effect {
    readonly on: (player: Dispatcher, value: number) => void;
    readonly off: (player: Dispatcher) => void;
}

const BASS_GAIN = 0.34;
const BASS_BANDS = [0, 1, 2, 3].map(band => ({ band, gain: BASS_GAIN }));

const EFFECTS: Record<string, Effect> = {
    '8d': {
        on: player => player.player.setRotation({ rotationHz: 0.2 }),
        off: player => player.player.setRotation(),
    },
    bassboost: {
        on: player => player.player.setEqualizer(BASS_BANDS),
        off: player => player.player.setEqualizer([]),
    },
    distortion: {
        on: player =>
            player.player.setDistortion({
                sinOffset: 0,
                sinScale: 1,
                cosOffset: 0,
                cosScale: 1,
                tanOffset: 0,
                tanScale: 1,
                offset: 0,
                scale: 1,
            }),
        off: player => player.player.setDistortion({}),
    },
    karaoke: {
        on: player =>
            player.player.setKaraoke({ level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }),
        off: player => player.player.setKaraoke(),
    },
    nightcore: {
        on: player => player.player.setTimescale({ speed: 1.165, pitch: 1.125, rate: 1.05 }),
        off: player => player.player.setTimescale(),
    },
    rotation: {
        on: player => player.player.setRotation({ rotationHz: 0 }),
        off: player => player.player.setRotation(),
    },
    tremolo: {
        on: player => player.player.setTremolo({ depth: 0.75, frequency: 4 }),
        off: player => player.player.setTremolo(),
    },
    vibrato: {
        on: player => player.player.setVibrato({ depth: 0.75, frequency: 4 }),
        off: player => player.player.setVibrato(),
    },
    lowpass: {
        on: player => player.player.setLowPass({ smoothing: 20 }),
        off: player => player.player.setLowPass({}),
    },
    pitch: {
        on: (player, value) => player.player.setTimescale({ pitch: value, rate: 1, speed: 1 }),
        off: player => player.player.setTimescale(),
    },
    rate: {
        on: (player, value) => player.player.setTimescale({ rate: value, pitch: value, speed: 1 }),
        off: player => player.player.setTimescale(),
    },
    speed: {
        on: (player, value) => player.player.setTimescale({ speed: value }),
        off: player => player.player.setTimescale(),
    },
};

/** Catalogue order is the order the dashboard renders the checkboxes in. */
export const FILTERS: readonly FilterDef[] = [
    {
        id: '8d',
        label: '8D',
        description: 'Rotating stereo image',
        activeName: '8D',
        group: 'rotation',
    },
    {
        id: 'bassboost',
        label: 'Bass boost',
        description: 'Low-band equalizer lift',
        activeName: 'bassboost',
    },
    {
        id: 'distortion',
        label: 'Distortion',
        description: 'Soft distortion effect',
        activeName: 'distorsion',
    },
    {
        id: 'karaoke',
        label: 'Karaoke',
        description: 'Remove center vocals',
        activeName: 'karaoke',
    },
    {
        id: 'nightcore',
        label: 'Nightcore',
        description: 'Faster, higher-pitched playback',
        activeName: 'nightcore',
        group: 'timescale',
    },
    {
        id: 'rotation',
        label: 'Rotation',
        description: 'Rotating channel effect',
        activeName: 'rotation',
        group: 'rotation',
    },
    {
        id: 'tremolo',
        label: 'Tremolo',
        description: 'Amplitude modulation',
        activeName: 'tremolo',
    },
    {
        id: 'vibrato',
        label: 'Vibrato',
        description: 'Pitch modulation',
        activeName: 'vibrato',
    },
    {
        id: 'lowpass',
        label: 'Low pass',
        description: 'Smooth high frequencies',
        activeName: 'lowpass',
    },
    {
        id: 'pitch',
        label: 'Pitch',
        description: 'Set pitch multiplier',
        value: { min: 1, max: 5, step: 0.05, fallback: 1 },
        activeName: 'pitch',
        group: 'timescale',
    },
    {
        id: 'rate',
        label: 'Rate',
        description: 'Set playback rate',
        value: { min: 0.5, max: 5, step: 0.05, fallback: 1 },
        activeName: 'rate',
        group: 'timescale',
    },
    {
        id: 'speed',
        label: 'Speed',
        description: 'Set playback speed',
        value: { min: 0.5, max: 5, step: 0.05, fallback: 1 },
        activeName: 'speed',
        group: 'timescale',
    },
];

function withinRange(filter: FilterDef, value: number | undefined): number {
    const fallback = filter.value?.fallback ?? 1;
    const requested = value ?? fallback;
    if (!filter.value) return requested;
    const usable = Number.isFinite(requested) ? requested : fallback;
    return Math.min(filter.value.max, Math.max(filter.value.min, usable));
}

/** Turning a grouped filter on implicitly turns its siblings off. */
function clearSiblings(player: Dispatcher, filter: FilterDef): void {
    if (!filter.group) return;
    for (const sibling of FILTERS) {
        if (sibling.id === filter.id || sibling.group !== filter.group) continue;
        if (!sibling.activeName) continue;
        player.filters = player.filters.filter(name => name !== sibling.activeName);
        delete player.filterValues[sibling.id];
    }
}

export function applyFilter(
    player: Dispatcher,
    id: string,
    enabled: boolean,
    value?: number
): void {
    const filter = FILTERS.find(entry => entry.id === id);
    const effect = EFFECTS[id];
    if (!filter || !effect) throw new Error('Unknown filter');

    if (!enabled) {
        effect.off(player);
        delete player.filterValues[filter.id];
        if (filter.activeName) {
            player.filters = player.filters.filter(name => name !== filter.activeName);
        }
        return;
    }

    clearSiblings(player, filter);
    const applied = withinRange(filter, value);
    effect.on(player, applied);
    if (filter.value) player.filterValues[filter.id] = applied;
    if (filter.activeName && !player.filters.includes(filter.activeName)) {
        player.filters.push(filter.activeName);
    }
}
