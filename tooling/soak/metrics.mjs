import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function fetchJson(url, options = {}, timeoutMs = 5000) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return await response.json();
}

export async function sampleMetrics({ url, headers = {}, timeoutMs = 5000 }) {
    return await fetchJson(url, { headers }, timeoutMs);
}

function growthPercent(from, to) {
    if (!from || from <= 0) return 0;
    return ((to - from) / from) * 100;
}

export function summarize(samples, thresholds, meta = {}) {
    if (!samples.length) {
        return { pass: false, reason: 'no samples', samples: 0, failures: ['no samples'] };
    }

    const duration = samples.at(-1).elapsedSec ?? 0;
    const warmupSec = duration >= 3600 ? 3600 : Math.max(1, duration * 0.2);
    const baseline = samples.find(sample => (sample.elapsedSec ?? 0) >= warmupSec) ?? samples[0];
    const last = samples.at(-1);
    const maxQueue = Math.max(...samples.map(sample => sample.maxQueueDepth ?? 0));
    const maxP99 = Math.max(...samples.map(sample => sample.eventLoop?.p99 ?? 0));
    const maxEventLoopMax = Math.max(...samples.map(sample => sample.eventLoop?.max ?? 0));
    const rssGrowthPct = growthPercent(baseline.memory?.rss, last.memory?.rss);
    const heapGrowthPct = growthPercent(baseline.memory?.heapUsed, last.memory?.heapUsed);
    let crashCount = 0;
    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1].uptimeSec ?? 0;
        const current = samples[index].uptimeSec ?? 0;
        if (current + 5 < previous) crashCount += 1;
    }

    const failures = [];
    if (samples.length < thresholds.minSamples)
        failures.push(`only ${samples.length} samples (min ${thresholds.minSamples})`);
    if (rssGrowthPct > thresholds.maxRssGrowthPct)
        failures.push(`RSS grew ${rssGrowthPct.toFixed(1)}% (max ${thresholds.maxRssGrowthPct}%)`);
    if (heapGrowthPct > thresholds.maxHeapGrowthPct)
        failures.push(
            `heap grew ${heapGrowthPct.toFixed(1)}% (max ${thresholds.maxHeapGrowthPct}%)`
        );
    if (maxP99 > thresholds.maxEventLoopP99Ms)
        failures.push(
            `event-loop p99 ${maxP99.toFixed(1)}ms (max ${thresholds.maxEventLoopP99Ms}ms)`
        );
    if (maxEventLoopMax > thresholds.maxEventLoopMaxMs)
        failures.push(
            `event-loop max ${maxEventLoopMax.toFixed(1)}ms (max ${thresholds.maxEventLoopMaxMs}ms)`
        );
    if (maxQueue > thresholds.maxQueueDepth)
        failures.push(`queue depth ${maxQueue} (max ${thresholds.maxQueueDepth})`);
    if (crashCount > thresholds.maxCrashCount)
        failures.push(`${crashCount} process uptime reset(s)`);

    return {
        pass: failures.length === 0,
        samples: samples.length,
        durationSec: duration,
        startedAt: samples[0].at,
        endedAt: last.at,
        baselineAt: baseline.at,
        rssGrowthPct,
        heapGrowthPct,
        maxEventLoopP99Ms: maxP99,
        maxEventLoopMaxMs: maxEventLoopMax,
        maxQueueDepth: maxQueue,
        crashCount,
        failures,
        meta,
    };
}

export async function writeReport(dir, summary) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    const lines = [
        '# Soak summary',
        '',
        `- Result: **${summary.pass ? 'PASS' : 'FAIL'}**`,
        `- Samples: ${summary.samples}`,
        `- Duration: ${(summary.durationSec / 3600).toFixed(2)} h`,
        `- RSS growth: ${summary.rssGrowthPct.toFixed(1)}%`,
        `- Heap growth: ${summary.heapGrowthPct.toFixed(1)}%`,
        `- Event-loop p99 max: ${summary.maxEventLoopP99Ms.toFixed(1)} ms`,
        `- Event-loop max: ${summary.maxEventLoopMaxMs.toFixed(1)} ms`,
        `- Max queue depth: ${summary.maxQueueDepth}`,
        `- Uptime resets: ${summary.crashCount}`,
        '',
    ];
    if (summary.failures.length) {
        lines.push('## Failures', ...summary.failures.map(failure => `- ${failure}`), '');
    }
    await writeFile(path.join(dir, 'summary.md'), `${lines.join('\n')}\n`);
}

export async function readSamples(file) {
    const text = await readFile(file, 'utf8');
    return text
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}
