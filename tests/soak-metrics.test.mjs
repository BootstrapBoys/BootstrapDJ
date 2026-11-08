import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readSamples, summarize, writeReport } from '../tooling/soak/metrics.mjs';

const thresholds = {
    maxRssGrowthPct: 10,
    maxHeapGrowthPct: 15,
    maxEventLoopP99Ms: 50,
    maxEventLoopMaxMs: 500,
    maxQueueDepth: 50,
    maxCrashCount: 0,
    minSamples: 3,
};

const sample = (overrides = {}) => ({
    at: '2026-01-01T00:00:00.000Z',
    elapsedSec: 0,
    uptimeSec: 1200,
    memory: { rss: 100, heapUsed: 50 },
    eventLoop: { p99: 2, max: 10 },
    maxQueueDepth: 5,
    ...overrides,
});

test('summarize passes a bounded soak', () => {
    const summary = summarize(
        [
            sample({ elapsedSec: 0 }),
            sample({ elapsedSec: 5, uptimeSec: 1205 }),
            sample({
                elapsedSec: 10,
                uptimeSec: 1210,
                memory: { rss: 105, heapUsed: 55 },
                eventLoop: { p99: 3, max: 20 },
                maxQueueDepth: 8,
            }),
        ],
        thresholds
    );

    assert.equal(summary.pass, true);
    assert.equal(summary.crashCount, 0);
    assert.equal(summary.maxQueueDepth, 8);
});

test('summarize fails growth, latency, depth and uptime resets', () => {
    const summary = summarize(
        [
            sample({ elapsedSec: 0 }),
            sample({ elapsedSec: 5, uptimeSec: 1205 }),
            sample({
                elapsedSec: 10,
                uptimeSec: 20,
                memory: { rss: 150, heapUsed: 80 },
                eventLoop: { p99: 100, max: 900 },
                maxQueueDepth: 90,
            }),
        ],
        thresholds
    );

    assert.equal(summary.pass, false);
    assert.equal(summary.crashCount, 1);
    assert.ok(summary.failures.some(failure => failure.includes('RSS grew')));
    assert.ok(summary.failures.some(failure => failure.includes('event-loop p99')));
    assert.ok(summary.failures.some(failure => failure.includes('queue depth')));
});

test('soak reports and sample logs round-trip', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrapdj-soak-'));
    try {
        const summary = summarize(
            [sample({ elapsedSec: 0 }), sample({ elapsedSec: 5 }), sample({ elapsedSec: 10 })],
            thresholds
        );
        await writeReport(dir, summary);
        assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /Result: \*\*PASS/);
        assert.equal(
            JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')).pass,
            true
        );

        fs.writeFileSync(path.join(dir, 'metrics.jsonl'), `${JSON.stringify(sample())}\n`);
        const samples = await readSamples(path.join(dir, 'metrics.jsonl'));
        assert.equal(samples.length, 1);
        assert.equal(samples[0].memory.rss, 100);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('summarize rejects an empty sample set', () => {
    const summary = summarize([], thresholds);
    assert.equal(summary.pass, false);
    assert.deepEqual(summary.failures, ['no samples']);
});
