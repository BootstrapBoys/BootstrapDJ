import type Dispatcher from '../structures/Dispatcher.js';

export type FilterDef = {
    id: string;
    label: string;
    description: string;
    value?: { min: number; max: number; step: number; fallback: number };
    activeName?: string;
    enable: (player: Dispatcher, value: number) => void;
    disable: (player: Dispatcher) => void;
};

export const FILTERS: FilterDef[] = [
    {
        id: '8d',
        label: '8D',
        description: 'Rotating stereo image',
        activeName: '8D',
        enable: player => player.player.setRotation({ rotationHz: 0.2 }),
        disable: player => player.player.setRotation(),
    },
    {
        id: 'bassboost',
        label: 'Bass boost',
        description: 'Low-band equalizer lift',
        activeName: 'bassboost',
        enable: player =>
            player.player.setEqualizer([
                { band: 0, gain: 0.34 },
                { band: 1, gain: 0.34 },
                { band: 2, gain: 0.34 },
                { band: 3, gain: 0.34 },
            ]),
        disable: player => player.player.setEqualizer([]),
    },
    {
        id: 'distortion',
        label: 'Distortion',
        description: 'Soft distortion effect',
        activeName: 'distorsion',
        enable: player =>
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
        disable: player => player.player.setDistortion({}),
    },
    {
        id: 'karaoke',
        label: 'Karaoke',
        description: 'Remove center vocals',
        activeName: 'karaoke',
        enable: player => player.player.setKaraoke({ level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }),
        disable: player => player.player.setKaraoke(),
    },
    {
        id: 'nightcore',
        label: 'Nightcore',
        description: 'Faster, higher-pitched playback',
        activeName: 'nightcore',
        enable: player => player.player.setTimescale({ speed: 1.165, pitch: 1.125, rate: 1.05 }),
        disable: player => player.player.setTimescale(),
    },
    {
        id: 'rotation',
        label: 'Rotation',
        description: 'Rotating channel effect',
        activeName: 'rotation',
        enable: player => player.player.setRotation({ rotationHz: 0 }),
        disable: player => player.player.setRotation(),
    },
    {
        id: 'tremolo',
        label: 'Tremolo',
        description: 'Amplitude modulation',
        activeName: 'tremolo',
        enable: player => player.player.setTremolo({ depth: 0.75, frequency: 4 }),
        disable: player => player.player.setTremolo(),
    },
    {
        id: 'vibrato',
        label: 'Vibrato',
        description: 'Pitch modulation',
        activeName: 'vibrato',
        enable: player => player.player.setVibrato({ depth: 0.75, frequency: 4 }),
        disable: player => player.player.setVibrato(),
    },
    {
        id: 'lowpass',
        label: 'Low pass',
        description: 'Smooth high frequencies',
        activeName: 'lowpass',
        enable: player => player.player.setLowPass({ smoothing: 20 }),
        disable: player => player.player.setLowPass({}),
    },
    {
        id: 'pitch',
        label: 'Pitch',
        description: 'Set pitch multiplier',
        value: { min: 1, max: 5, step: 0.05, fallback: 1 },
        activeName: 'pitch',
        enable: (player, value) => player.player.setTimescale({ pitch: value, rate: 1, speed: 1 }),
        disable: player => player.player.setTimescale(),
    },
    {
        id: 'rate',
        label: 'Rate',
        description: 'Set playback rate',
        value: { min: 0.5, max: 5, step: 0.05, fallback: 1 },
        activeName: 'rate',
        enable: (player, value) => player.player.setTimescale({ rate: value, pitch: value, speed: 1 }),
        disable: player => player.player.setTimescale(),
    },
    {
        id: 'speed',
        label: 'Speed',
        description: 'Set playback speed',
        value: { min: 0.5, max: 5, step: 0.05, fallback: 1 },
        activeName: 'speed',
        enable: (player, value) => player.player.setTimescale({ speed: value }),
        disable: player => player.player.setTimescale(),
    },
];

export const FILTER_GROUPS: string[][] = [
    ['nightcore', 'pitch', 'rate', 'speed'],
    ['8d', 'rotation'],
];

export function applyFilter(player: Dispatcher, id: string, enabled: boolean, value?: number): void {
    const def = FILTERS.find(filter => filter.id === id);
    if (!def) throw new Error('Unknown filter');
    if (enabled) {
        const base = value ?? def.value?.fallback ?? 1;
        const applied = def.value
            ? Math.min(def.value.max, Math.max(def.value.min, Number.isFinite(base) ? base : def.value.fallback))
            : base;
        for (const group of FILTER_GROUPS) {
            if (!group.includes(id)) continue;
            for (const siblingId of group) {
                if (siblingId === id) continue;
                const sibling = FILTERS.find(filter => filter.id === siblingId);
                if (!sibling?.activeName) continue;
                player.filters = player.filters.filter(name => name !== sibling.activeName);
                delete player.filterValues[sibling.id];
            }
        }
        def.enable(player, applied);
        if (def.value) player.filterValues[def.id] = applied;
        if (def.activeName && !player.filters.includes(def.activeName)) player.filters.push(def.activeName);
    } else {
        def.disable(player);
        delete player.filterValues[def.id];
        if (def.activeName) player.filters = player.filters.filter(name => name !== def.activeName);
    }
}
