import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import 'dotenv/config';

import { sampleMetrics, summarize, writeReport } from './metrics.mjs';
import { workloadConfig, workloadStep } from './workload.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function loadThresholds() {
    const file = new URL('./thresholds.json', import.meta.url);
    return JSON.parse(await readFile(file, 'utf8'));
}

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function artifactsDir() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.resolve(process.env.SOAK_ARTIFACTS ?? 'artifacts/soak', stamp);
}

async function appendJsonl(file, value) {
    await appendFile(file, `${JSON.stringify(value)}\n`);
}

async function main() {
    if (process.env.PRODUCTION === 'true') {
        throw new Error('refusing to soak with PRODUCTION=true');
    }
    const guildId = process.env.SOAK_GUILD_ID;
    if (!guildId) throw new Error('SOAK_GUILD_ID is required');
    if (process.env.SOAK_EXPECTED_GUILD_ID && guildId !== process.env.SOAK_EXPECTED_GUILD_ID) {
        throw new Error('SOAK_GUILD_ID does not match SOAK_EXPECTED_GUILD_ID');
    }

    const thresholds = await loadThresholds();
    const hours = envNumber('SOAK_HOURS', 0.1);
    const sampleMs = Math.max(5_000, envNumber('SOAK_SAMPLE_SECONDS', 30) * 1000);
    const workloadMs = Math.max(10_000, envNumber('SOAK_WORKLOAD_SECONDS', 300) * 1000);
    const workloadEnabled = process.env.SOAK_WORKLOAD !== '0';
    const dashboardUrl = process.env.SOAK_METRICS_URL ?? 'http://127.0.0.1:8796/api/metrics';
    const headers = process.env.SOAK_METRICS_TOKEN
        ? { authorization: `Bearer ${process.env.SOAK_METRICS_TOKEN}` }
        : {};
    const config = workloadEnabled ? workloadConfig(process.env) : null;

    const dir = artifactsDir();
    await mkdir(dir, { recursive: true });
    const metricsFile = path.join(dir, 'metrics.jsonl');
    const workloadFile = path.join(dir, 'workload.jsonl');
    const meta = {
        startedAt: new Date().toISOString(),
        hours,
        sampleSeconds: sampleMs / 1000,
        workload: workloadEnabled,
        dashboardUrl,
        guildId,
        commit: process.env.GITHUB_SHA ?? process.env.SOAK_COMMIT ?? 'unknown',
        branch: process.env.GITHUB_REF_NAME ?? process.env.SOAK_BRANCH ?? 'unknown',
        node: process.version,
        host: os.hostname(),
    };
    await writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

    const samples = [];
    const failures = [];
    const started = Date.now();
    const deadline = started + hours * 3600_000;
    const checkpoints = [3600_000, 6 * 3600_000, 12 * 3600_000, 24 * 3600_000];
    const fired = new Set();

    let stop = false;
    const interrupt = () => {
        stop = true;
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);

    let step = 0;
    let nextWorkload = started;
    try {
        while (Date.now() < deadline && !stop) {
            try {
                const data = await sampleMetrics({ url: dashboardUrl, headers });
                const players = Array.isArray(data.players) ? data.players : [];
                const maxQueueDepth = players.reduce(
                    (max, player) => Math.max(max, (player.queue ?? 0) + (player.playing ? 1 : 0)),
                    0
                );
                const sample = {
                    ...data,
                    elapsedSec: Math.round((Date.now() - started) / 1000),
                    maxQueueDepth,
                };
                samples.push(sample);
                await appendJsonl(metricsFile, sample);
            } catch (error) {
                failures.push(
                    `metrics sample failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }

            if (config && Date.now() >= nextWorkload) {
                const result = await workloadStep(config, step++);
                await appendJsonl(workloadFile, { at: new Date().toISOString(), ...result });
                nextWorkload = Date.now() + workloadMs;
            }

            const elapsed = Date.now() - started;
            for (const checkpoint of checkpoints) {
                if (elapsed >= checkpoint && !fired.has(checkpoint)) {
                    fired.add(checkpoint);
                    console.log(`checkpoint ${checkpoint / 3600_000}h samples=${samples.length}`);
                }
            }

            const remaining = deadline - Date.now();
            if (remaining > 0) await sleep(Math.min(sampleMs, remaining));
        }
    } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
    }

    const summary = summarize(samples, thresholds, meta);
    summary.failures = [...summary.failures, ...failures];
    summary.pass = summary.pass && failures.length === 0;
    await writeReport(dir, summary);
    await writeFile(path.join(dir, 'samples.json'), `${JSON.stringify(samples, null, 2)}\n`);

    console.log(`result: ${summary.pass ? 'PASS' : 'FAIL'}`);
    console.log(`artifacts: ${dir}`);
    if (!summary.pass) {
        console.error(summary.failures.join('\n'));
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
