import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readSamples, summarize, writeReport } from './metrics.mjs';

const dir = process.argv[2];
if (!dir) {
    console.error('usage: node tooling/soak/report.mjs <artifacts-dir>');
    process.exit(2);
}

const thresholds = JSON.parse(
    await readFile(new URL('./thresholds.json', import.meta.url), 'utf8')
);
const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => '{}'));
const samples = await readSamples(path.join(dir, 'metrics.jsonl'));
const summary = summarize(samples, thresholds, meta);
await writeReport(dir, summary);
console.log(`${summary.pass ? 'PASS' : 'FAIL'} ${dir}`);
console.log(`samples=${summary.samples} rssGrowth=${summary.rssGrowthPct.toFixed(1)}%`);
if (!summary.pass) {
    console.error(summary.failures.join('\n'));
    process.exitCode = 1;
}
