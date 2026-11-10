// Headless browser harness for the dashboard audio tap.
//
// Serves the real dashboard document with fake dashboard APIs and replays a
// captured tap stream. Used to prove WebCodecs decoding and local mute without
// a Discord session:
//
//   node tooling/audio-tap-harness.mjs
//   open http://127.0.0.1:8799/ and click Listen
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { renderDashboard } from '../dist/dashboard/page.js';
import { initialState } from '../dist/dashboard/state.js';

const GUILD = '123456789012345678';
const PORT = Number(process.env.PORT || 8799);
const FIXTURE =
    process.env.TAP_FIXTURE ||
    fileURLToPath(new URL('../tests/fixtures/tap-sample.bin', import.meta.url));

const ACCESS = {
    member: true,
    owner: true,
    admin: true,
    controls: true,
    settings: true,
};

const PLAYER = {
    title: 'Tap harness track',
    author: 'Local fixture',
    duration: 180000,
    position: 0,
    queueLength: 0,
    upcoming: [],
    volume: 100,
    paused: false,
    loop: 'off',
    autoplay: false,
    activeFilters: [],
    filterValues: {},
};

function parsePackets(raw) {
    const packets = [];
    let offset = 0;
    while (offset + 3 <= raw.length) {
        const type = raw[offset];
        const length = raw.readUInt16BE(offset + 1);
        const total = type === 1 ? 11 + length : 3 + length;
        if (offset + total > raw.length) break;
        packets.push(raw.subarray(offset, offset + total));
        offset += total;
    }
    return packets;
}

const packets = parsePackets(fs.readFileSync(FIXTURE));

function sendJson(res, status, payload) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/') {
        res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
        });
        res.end(renderDashboard(false));
        return;
    }

    if (url.pathname === '/api/guilds') {
        sendJson(res, 200, {
            csrf: 'harness-csrf',
            guilds: [{ id: GUILD, name: 'Harness guild', ...ACCESS }],
            viewer: { name: 'Harness', owner: true, admin: true },
        });
        return;
    }

    if (url.pathname === '/api/state') {
        sendJson(res, 200, {
            ...initialState(GUILD, PLAYER),
            permissions: ACCESS,
            settings: {},
            audio: { available: true },
        });
        return;
    }

    if (url.pathname === '/api/player-state') {
        sendJson(res, 200, { player: PLAYER });
        return;
    }

    if (url.pathname === '/api/audio') {
        res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'cache-control': 'no-store',
            'x-accel-buffering': 'no',
        });

        let index = 0;
        const timer = setInterval(() => {
            if (index >= packets.length) {
                clearInterval(timer);
                res.end();
                return;
            }
            res.write(packets[index]);
            index += 1;
        }, 20);
        res.on('close', () => clearInterval(timer));
        return;
    }

    sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`audio tap harness: http://127.0.0.1:${PORT}/ (${packets.length} packets)`);
});
