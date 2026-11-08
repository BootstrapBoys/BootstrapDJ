import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const upstream = process.argv[2];
if (!upstream) {
    console.error('usage: node tooling/rewrite-audit.mjs <upstream-src>');
    process.exit(2);
}

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

function lines(file) {
    return readFileSync(file, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
}

const upstreamByName = new Map();
for (const file of walk(upstream)) {
    const list = upstreamByName.get(basename(file)) ?? [];
    list.push(file);
    upstreamByName.set(basename(file), list);
}

const rows = [];
for (const file of walk('src')) {
    const peers = upstreamByName.get(basename(file));
    if (!peers?.length) continue;
    const current = lines(file);
    let best = { matched: 0, peer: null };
    for (const peer of peers) {
        const other = lines(peer);
        const counts = new Map();
        for (const line of other) counts.set(line, (counts.get(line) ?? 0) + 1);
        let matched = 0;
        for (const line of current) {
            const count = counts.get(line) ?? 0;
            if (count > 0) {
                matched += 1;
                counts.set(line, count - 1);
            }
        }
        if (matched > best.matched) best = { matched, peer };
    }
    if (best.peer) {
        rows.push({
            current: relative('.', file),
            peer: relative(upstream, best.peer),
            matched: best.matched,
            currentLines: current.length,
        });
    }
}

rows.sort((a, b) => b.matched - a.matched || a.current.localeCompare(b.current));
const total = rows.reduce((sum, row) => sum + row.matched, 0);
console.log(`same-basename files: ${rows.length}`);
console.log(`shared lines floor: ${total}`);
console.log('matched/current\tcurrent\tupstream');
for (const row of rows) {
    console.log(`${row.matched}/${row.currentLines}\t${row.current}\t${row.peer}`);
}
