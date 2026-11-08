import { spawn } from 'node:child_process';

type LoudnessResult = { lufs: number } | null;

const cache = new Map<string, LoudnessResult>();
const pending = new Map<string, Promise<LoudnessResult>>();
const MAX_CACHE = 300;
const SAMPLE_SECONDS = 20;

function remember(uri: string, value: LoudnessResult): LoudnessResult {
    cache.set(uri, value);
    if (cache.size > MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
    }
    return value;
}

function analyze(uri: string, timeoutMs: number): Promise<LoudnessResult> {
    return new Promise(resolve => {
        const child = spawn(
            'ffmpeg',
            ['-hide_banner', '-nostats', '-loglevel', 'info', '-vn', '-t', String(SAMPLE_SECONDS), '-i', uri, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
            { stdio: ['ignore', 'ignore', 'pipe'] }
        );
        let stderr = '';
        let settled = false;
        const finish = (value: LoudnessResult): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill('SIGKILL');
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        child.stderr?.on('data', chunk => {
            stderr += chunk.toString();
            if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
        });
        child.on('error', () => finish(null));
        child.on('close', () => {
            const matches = [...stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
            const last = matches[matches.length - 1];
            const lufs = last ? Number(last[1]) : NaN;
            finish(Number.isFinite(lufs) ? { lufs } : null);
        });
    });
}

/** Integrated loudness for a track, cached by URL. Returns null when the
 * source cannot be sampled (streams, protected URLs, missing ffmpeg). */
export async function loudnessOf(uri: string, timeoutMs: number = 25_000): Promise<LoudnessResult> {
    if (cache.has(uri)) return cache.get(uri) ?? null;
    const existing = pending.get(uri);
    if (existing) return await existing;
    const promise = analyze(uri, timeoutMs).then(value => {
        pending.delete(uri);
        return remember(uri, value);
    });
    pending.set(uri, promise);
    return await promise;
}

/** Convert measured LUFS and a target into a clamped player volume. */
export function volumeForLoudness(measuredLufs: number, targetLufs: number, baseVolume: number = 100): number {
    const gainDb = Math.max(-12, Math.min(12, targetLufs - measuredLufs));
    return Math.max(1, Math.min(200, Math.round(baseVolume * 10 ** (gainDb / 20))));
}
