// Drive the headless Chromium CDP endpoint against the audio-tap harness.
// Proves WebCodecs decode and that mute is a local GainNode change.
//
//   node tooling/audio-tap-browser-test.mjs
// Env: CDP_URL (default http://127.0.0.1:9223), PAGE_URL (default harness),
//      SHOT (optional screenshot path), HEADLESS_CDP=1 required implicitly.
import fs from 'node:fs';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9223';
const PAGE_URL = process.env.PAGE_URL || 'http://127.0.0.1:8799/';
const SHOT = process.env.SHOT || '';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const targets = await (await fetch(`${CDP_URL}/json`)).json();
const page = targets.find(target => target.type === 'page');
if (!page) throw new Error('No page target on the CDP endpoint');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const entry = message.id ? pending.get(message.id) : undefined;
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
});

function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
            if (!pending.has(id)) return;
            pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
        }, 15000);
    });
}

async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'evaluate failed');
    }
    return result.result.value;
}

async function waitFor(expression, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await sleep(200);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
}

async function click(selector) {
    const point = await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        node.scrollIntoView({ block: 'center' });
        const rect = node.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    if (!point) throw new Error(`Missing ${selector}`);
    await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
    });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Page.navigate', { url: PAGE_URL });
await sleep(1500);

const targetGuild = process.env.GUILD_ID || '';
if (targetGuild) {
    const changed = await evaluate(`(() => {
        const select = document.querySelector('#guild');
        if (!select || select.value === ${JSON.stringify(targetGuild)}) return false;
        select.value = ${JSON.stringify(targetGuild)};
        if (select.value !== ${JSON.stringify(targetGuild)}) return false;
        select.dispatchEvent(new Event('change'));
        return true;
    })()`);
    if (changed) {
        await sleep(1200);
        await waitFor(
            `document.querySelector('#guild') && document.querySelector('#guild').value === ${JSON.stringify(targetGuild)}`
        );
    }
}

const support = await evaluate(
    '({ decoder: typeof AudioDecoder, chunk: typeof EncodedAudioChunk })'
);
await waitFor(
    "(() => { const b = document.querySelector('#listen-btn'); return b && getComputedStyle(b).display !== 'none'; })()"
);
await click('#listen-btn');

await waitFor("window.__bdjAudio && window.__bdjAudio.debug().status === 'on'", 15000);
await waitFor('window.__bdjAudio && window.__bdjAudio.debug().frames > 25', 15000);
await sleep(1000);
const playing = await evaluate('window.__bdjAudio.debug()');
const volumeExpression =
    "fetch('/api/state?guildId=' + encodeURIComponent(document.querySelector('#guild').value))" +
    '.then(r => r.json()).then(d => d.player.volume)';
const volumeBefore = await evaluate(volumeExpression);

await click('#listen-btn');
await sleep(400);
const muted = await evaluate('window.__bdjAudio.debug()');
const volumeDuringMute = await evaluate(volumeExpression);

await click('#listen-btn');
await sleep(400);
const unmuted = await evaluate('window.__bdjAudio.debug()');
const volumeAfter = await evaluate(volumeExpression);

if (SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
}

const report = { support, playing, muted, unmuted, volumeBefore, volumeDuringMute, volumeAfter };
console.log(JSON.stringify(report, null, 2));

const failures = [];
if (!support.decoder || !support.chunk) failures.push('WebCodecs unavailable');
if (playing.status !== 'on') failures.push('audio did not reach on');
if (!(playing.frames > 0)) failures.push('no tap frames');
if (!(playing.decoded > 0)) failures.push('no decoded AudioData');
if (!(playing.rms > 0)) failures.push('decoded audio is silent');
if (playing.sampleRate !== 48000) failures.push('unexpected sample rate');
if (playing.context !== 'running') failures.push('AudioContext is not running');
if (muted.gain !== 0 || muted.muted !== true) failures.push('mute did not set gain to 0');
if (muted.rms !== 0) failures.push('muted audio still has signal');
if (unmuted.gain !== 1 || unmuted.muted !== false) failures.push('unmute did not restore gain 1');
if (!(unmuted.rms > 0)) failures.push('unmuted audio has no signal');
if (volumeBefore !== volumeDuringMute || volumeBefore !== volumeAfter) {
    failures.push('mute changed the server-side player volume');
}

if (failures.length) {
    console.error('FAILED: ' + failures.join('; '));
    process.exit(1);
}
console.log('PASS: decoded audio frames and local mute');
socket.close();
process.exit(0);
