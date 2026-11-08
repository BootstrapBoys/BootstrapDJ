import type { Song } from '../Dispatcher.js';

export type AutoplaySource = 'chart' | 'curated' | 'legacy';

export interface ColdStartConfig {
    source: string | null | undefined;
    seeds: string | null;
}

export interface ColdStartHost {
    getConfig(): Promise<ColdStartConfig | null>;
    config: {
        autoplaySeeds?: string[];
        autoplayChart?: boolean;
        autoplaySeed?: string;
    };
    chartSeed(): Promise<Song | null>;
    curatedSeed(seeds: string[]): Promise<Song | null>;
    pickFromQuery(query: string): Promise<Song | null>;
}

export interface ColdStartPolicy {
    source: AutoplaySource;
    seeds: string[];
}

/** Resolve the stored override first, then the environment defaults. */
export function resolveColdStart(
    setting: ColdStartConfig | null,
    config: ColdStartHost['config']
): ColdStartPolicy {
    const storedSeeds = (setting?.seeds ?? '')
        .split(',')
        .map(seed => seed.trim())
        .filter(Boolean);
    const seeds = storedSeeds.length ? storedSeeds : (config.autoplaySeeds ?? []);
    const configured = setting?.source;
    const source: AutoplaySource =
        configured === 'chart' || configured === 'curated' || configured === 'legacy'
            ? configured
            : config.autoplayChart
              ? 'chart'
              : seeds.length
                ? 'curated'
                : 'legacy';
    return { source, seeds };
}

/** Chart then curated then legacy, falling through when a source is empty. */
export async function findColdStart(host: ColdStartHost): Promise<Song | null> {
    const setting = await host.getConfig().catch(() => null);
    const policy = resolveColdStart(setting, host.config);
    if (policy.source === 'chart') {
        const chart = await host.chartSeed();
        if (chart) return chart;
    }
    if (policy.source === 'chart' || policy.source === 'curated') {
        const curated = await host.curatedSeed(policy.seeds);
        if (curated) return curated;
    }
    if (host.config.autoplaySeed) {
        return await host.pickFromQuery(host.config.autoplaySeed);
    }
    return null;
}
