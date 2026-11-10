import { BROWSER_SCRIPT } from './browser.js';

/**
 * Stylesheet for the dashboard. Written as ordinary CSS (not minified) because
 * it ships once per page load and is easier to review this way.
 */
const STYLES = String.raw`
:root {
    color-scheme: dark;
    --bg: #111318;
    --panel: #191d25;
    --panel-2: #222834;
    --text: #eef1f6;
    --muted: #9aa7b8;
    --accent: #7c9cff;
    --ok: #55d68b;
    --bad: #ff7272;
    --line: #2b3340;
    --line-strong: #394556;
    --line-soft: #2f3948;
}
* { box-sizing: border-box; }
body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.45 system-ui, Segoe UI, sans-serif;
}
header {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    padding: 18px 22px;
    border-bottom: 1px solid var(--line);
}
h1 { font-size: 18px; margin: 0; letter-spacing: 0.2px; }
h2 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 0 0 10px;
}
main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 22px;
    display: grid;
    gap: 18px;
}
.panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
}
select, input, button {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    padding: 8px 10px;
    font: inherit;
}
button { cursor: pointer; }
button.primary {
    background: var(--accent);
    color: #0d1220;
    border-color: var(--accent);
    font-weight: 650;
}
.small { font-size: 12px; color: var(--muted); }
.error { color: var(--bad); }
.ok { color: var(--ok); }

/* Player */
.player-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
}
.player-top h2 { margin: 0; }
.now { font-size: 18px; font-weight: 650; margin: 10px 0 2px; }
.now-meta { color: var(--muted); font-size: 13px; }
.now-time {
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    margin-top: 3px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
}
.progress-wrap {
    position: relative;
    padding: 9px 0;
    margin: 3px 0 12px;
    cursor: pointer;
    outline: none;
}
.progress-wrap .progress {
    height: 6px;
    background: var(--line);
    border-radius: 99px;
    overflow: hidden;
    margin: 0;
}
.progress-wrap:focus-visible .progress { box-shadow: 0 0 0 2px var(--accent); }
.progress-wrap.disabled { cursor: default; }
.progress-tooltip {
    position: absolute;
    left: 0;
    bottom: calc(100% - 2px);
    transform: translateX(-50%);
    background: #0b0f17;
    border: 1px solid #4b5a6e;
    color: var(--text);
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    z-index: 10;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s;
}
.progress-tooltip.show { opacity: 1; }
.progress > div {
    height: 100%;
    width: 100%;
    background: var(--accent);
    transform: scaleX(0);
    transform-origin: left;
    will-change: transform;
}

/* Transport controls */
.controls {
    display: flex;
    gap: 7px;
    align-items: center;
    flex-wrap: wrap;
    margin: 12px 0 16px;
}
.ctrl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: var(--panel-2);
    border: 1px solid var(--line-strong);
    color: var(--text);
    border-radius: 9px;
    min-width: 38px;
    padding: 8px 10px;
    font-size: 15px;
}
.ctrl:hover { border-color: var(--accent); }
.ctrl.on { border-color: var(--accent); color: var(--accent); }
.listen-btn { margin-left: auto; gap: 6px; }
.listen-btn span { font-size: 12px; font-weight: 600; }
.listen-btn.muted { color: var(--muted); border-style: dashed; }
.listen-btn .mute-line { display: none; stroke: currentColor; stroke-width: 2; fill: none; }
.listen-btn.muted .mute-line { display: block; }
.disconnect-btn { gap: 6px; color: var(--muted); }
.disconnect-btn span { font-size: 12px; font-weight: 600; }
.disconnect-btn:hover { color: var(--bad); border-color: var(--bad); }
.ctrl svg, .volume svg { width: 18px; height: 18px; display: block; fill: currentColor; flex: none; }
.volume svg { color: var(--text); }
.ctrl .play-icon { display: none; }
.ctrl.paused .play-icon { display: block; }
.ctrl.paused .pause-icon { display: none; }
.volume {
    display: flex;
    gap: 7px;
    align-items: center;
    color: var(--muted);
    font-size: 12px;
    margin-left: auto;
}
.volume input { width: 220px; accent-color: var(--accent); }

/* Queue add */
.queue-add { display: flex; gap: 8px; align-items: center; margin: 0 0 16px; }
.queue-add input { flex: 1; min-width: 0; }
.queue-add button { flex: none; }

/* Queue */
.queue-block { border-top: 1px solid var(--line-soft); padding-top: 12px; }
.queue-head { display: flex; justify-content: space-between; align-items: baseline; }
.queue-head h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
    margin: 0 0 8px;
}
.queue-list { display: grid; gap: 5px; max-height: 260px; overflow: auto; }
.queue-item {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 7px 9px;
    background: var(--panel-2);
    border-radius: 7px;
    font-size: 13px;
    cursor: pointer;
}
.queue-item:hover { border: 1px solid var(--accent); padding: 6px 8px; }
.queue-item .qpos { color: var(--muted); width: 20px; flex: none; }
.queue-item .qtitle { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-item .qmeta { color: var(--muted); font-size: 12px; flex: none; }

/* Filters */
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
.filter {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: var(--panel-2);
    border: 1px solid var(--line-soft);
    border-radius: 10px;
    padding: 11px;
}
.filter label { display: flex; gap: 9px; align-items: center; flex: 1; cursor: pointer; }
.filter input[type='checkbox'] { accent-color: var(--accent); width: 18px; height: 18px; }
.filter .value { width: 84px; padding: 6px; margin-top: 6px; }

/* Settings */
.settings { display: grid; gap: 18px; }
.settings-group { border-top: 1px solid var(--line-soft); padding-top: 13px; }
.settings-group:first-child { border-top: 0; padding-top: 0; }
.settings-group h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--accent);
    margin: 0 0 9px;
}
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.setting { display: grid; gap: 5px; }
.setting input, .setting select { width: 100%; }
.setting-label { display: flex; align-items: center; gap: 6px; min-width: 0; }
.setting.wide { grid-column: 1 / -1; }
.help {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1px solid #4b5a6e;
    border-radius: 50%;
    color: var(--muted);
    font-size: 10px;
    font-weight: 700;
    cursor: help;
    flex: none;
    outline: none;
}
.help:hover, .help:focus { color: var(--accent); border-color: var(--accent); }
.help::after {
    content: attr(data-tip);
    position: absolute;
    left: 0;
    top: 22px;
    width: max-content;
    max-width: 260px;
    white-space: normal;
    background: #0b0f17;
    border: 1px solid #4b5a6e;
    color: var(--text);
    padding: 8px 10px;
    border-radius: 7px;
    font-size: 12px;
    line-height: 1.35;
    font-weight: 400;
    z-index: 30;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px);
    transition: opacity 0.12s, transform 0.12s;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.help:hover::after, .help:focus::after { opacity: 1; transform: translateY(0); }
.autoplay-reset {
    margin-top: 9px;
    background: transparent;
    border-color: var(--line-strong);
    color: var(--muted);
    padding: 6px 9px;
    font-size: 12px;
}
.status { display: flex; gap: 18px; flex-wrap: wrap; color: var(--muted); font-size: 13px; }
.status b { color: var(--text); }

/* Header buttons and modals */
.gear {
    background: transparent;
    border-color: transparent;
    color: var(--muted);
    font-size: 22px;
    line-height: 1;
    padding: 6px 9px;
    border-radius: 8px;
}
.gear:hover { color: var(--text); background: var(--panel-2); border-color: var(--line-strong); }
.gear svg { width: 22px; height: 22px; display: block; fill: currentColor; }
.modal {
    position: fixed;
    inset: 0;
    background: rgba(5, 8, 14, 0.72);
    display: none;
    align-items: flex-start;
    justify-content: center;
    padding: 32px 16px;
    overflow: auto;
    z-index: 20;
}
.modal.open { display: flex; }
.modal-card {
    width: min(980px, 100%);
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    padding: 18px;
}
.modal-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
}
.modal-head h2 { margin: 0; color: var(--text); font-size: 16px; text-transform: none; letter-spacing: 0; }
.icon-btn {
    background: var(--panel-2);
    border: 1px solid var(--line-strong);
    color: var(--text);
    border-radius: 8px;
    padding: 7px 10px;
    cursor: pointer;
}

/* Playlists */
.playlist-card { width: min(980px, 100%); }
.playlist-create {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 14px;
}
.playlist-create input { flex: 1; min-width: 190px; }
.playlist-layout {
    display: grid;
    grid-template-columns: minmax(190px, 240px) minmax(0, 1fr);
    gap: 14px;
    min-height: 320px;
}
.playlist-list {
    display: grid;
    gap: 6px;
    align-content: start;
    max-height: 58vh;
    overflow: auto;
}
.playlist-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    padding: 10px;
    border: 1px solid var(--line-soft);
    border-radius: 9px;
    background: var(--panel-2);
    cursor: pointer;
}
.playlist-row:hover { border-color: var(--line-strong); }
.playlist-row.active { border-color: var(--accent); background: #202a3d; }
.playlist-row .playlist-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.playlist-detail { min-width: 0; }
.playlist-detail-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.playlist-detail-head h3 { margin: 0 auto 0 0; font-size: 15px; }
.playlist-track {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--line-soft);
}
.playlist-track:first-child { border-top: 0; }
.playlist-track .track-pos { color: var(--muted); width: 22px; flex: none; text-align: right; }
.playlist-track .track-main { min-width: 0; flex: 1; }
.playlist-track .track-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.playlist-track .track-meta { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.playlist-track .track-remove {
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 4px 6px;
}
.playlist-track .track-remove:hover { color: var(--bad); }
.playlist-add { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.playlist-add input { flex: 1; min-width: 180px; }
.playlist-empty { color: var(--muted); padding: 12px 0; }
.playlist-detail > .small { margin-top: 0; }
@media (max-width: 720px) {
    .playlist-layout { grid-template-columns: 1fr; }
    .playlist-list { max-height: 180px; }
}

/* Statistics */
.stats-card { width: min(1120px, 100%); }
.stats-toolbar { display: flex; gap: 8px; align-items: center; }
.stats-toolbar select { padding: 7px 9px; }
.stat-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
}
.stat-card {
    background: var(--panel-2);
    border: 1px solid var(--line-soft);
    border-radius: 10px;
    padding: 12px;
}
.stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
}
.stat-value {
    font-size: 24px;
    font-weight: 700;
    margin-top: 5px;
    font-variant-numeric: tabular-nums;
}
.stats-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; margin-bottom: 14px; }
.stats-grid.two { grid-template-columns: 1fr 1fr; }
.stats-block {
    background: var(--panel-2);
    border: 1px solid var(--line-soft);
    border-radius: 10px;
    padding: 12px;
    min-width: 0;
}
.stats-block h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 0 0 10px;
}
.bars { display: flex; align-items: flex-end; gap: 4px; height: 150px; }
.bar-wrap {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    flex: 1;
    height: 100%;
    min-width: 0;
}
.bar {
    width: 100%;
    max-width: 28px;
    background: linear-gradient(180deg, var(--accent), #4d6bd6);
    border-radius: 4px 4px 0 0;
    min-height: 2px;
}
.bar-label {
    font-size: 10px;
    color: var(--muted);
    margin-top: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
}
.pie { width: 170px; height: 170px; border-radius: 50%; margin: 6px auto 12px; position: relative; }
.pie.empty { background: var(--panel); border: 1px dashed var(--line-strong); }
.legend { display: grid; gap: 5px; font-size: 12px; color: var(--muted); }
.legend span { display: flex; align-items: center; gap: 7px; }
.dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; flex: none; }
.stat-list { display: grid; gap: 5px; }
.stat-row {
    display: flex;
    gap: 9px;
    align-items: center;
    background: var(--panel);
    border-radius: 7px;
    padding: 8px 9px;
    font-size: 13px;
    min-width: 0;
}
.stat-index { color: var(--muted); width: 18px; flex: none; }
.stat-main { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stat-sub { color: var(--muted); font-size: 11px; }
.stat-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--panel-2);
    flex: none;
    object-fit: cover;
}
.service-icon {
    width: 16px;
    height: 16px;
    object-fit: contain;
    vertical-align: -3px;
    margin-right: 6px;
    border-radius: 3px;
}
.stat-main a { color: var(--text); text-decoration: none; }
.stat-main a:hover { color: var(--accent); text-decoration: underline; }

/* Footer and toast */
footer {
    border-top: 1px solid var(--line);
    margin-top: 2px;
    padding: 14px 22px 20px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
}
footer a { color: var(--muted); text-decoration: none; margin: 0 5px; }
footer a:hover { color: var(--accent); text-decoration: underline; }
footer .sep { color: #4b5a6e; margin: 0 2px; }
#toast {
    position: fixed;
    right: 18px;
    bottom: 18px;
    padding: 10px 14px;
    border-radius: 9px;
    background: var(--panel-2);
    border: 1px solid var(--line-strong);
    opacity: 0;
    transition: 0.2s;
}
#toast.show { opacity: 1; }

@media (max-width: 680px) {
    body { font-size: 14px; }
    header { flex-direction: column; align-items: stretch; padding: 14px 14px 12px; gap: 10px; }
    header > div { width: 100%; flex-wrap: wrap; }
    header h1 { font-size: 17px; }
    #guild { flex: 1; min-width: 0; }
    .gear { font-size: 24px; padding: 8px 11px; min-height: 44px; }
    main { padding: 12px; gap: 12px; }
    .panel { padding: 13px; border-radius: 10px; }
    .now { font-size: 16px; margin-top: 8px; }
    .controls { gap: 6px; }
    .ctrl { min-width: 44px; min-height: 44px; padding: 8px; }
    .volume { margin-left: 0; width: 100%; justify-content: space-between; order: 10; margin-top: 3px; }
    .volume input { flex: 1; width: auto; }
    .queue-list { max-height: 220px; }
    .queue-item { font-size: 12px; padding: 7px; }
    .queue-item .qmeta { font-size: 11px; max-width: 42%; overflow: hidden; text-overflow: ellipsis; }
    .filters { grid-template-columns: 1fr; }
    .settings { display: block; }
    .settings-group { margin-bottom: 16px; }
    .settings-grid { grid-template-columns: 1fr; }
    .setting.wide { grid-column: auto; }
    .modal { padding: 0; align-items: flex-end; }
    .modal-card {
        width: 100%;
        max-height: 94vh;
        overflow: auto;
        border-radius: 16px 16px 0 0;
        padding: 16px 14px 20px;
    }
    .modal-head { position: sticky; top: 0; background: var(--panel); z-index: 2; padding-bottom: 10px; }
    .icon-btn, .primary { min-height: 42px; }
    .stats-grid, .stats-grid.two { grid-template-columns: 1fr; }
    .stats-card { max-height: 94vh; overflow: auto; }
    .stat-value { font-size: 20px; }
    .bar-label { display: none; }
}

@media (max-width: 380px) {
    header h1 { font-size: 16px; }
    .ctrl { min-width: 40px; }
    .now { font-size: 15px; }
}
`;

const LOGIN_STYLES = String.raw`
body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #090d14;
    color: #e8eef7;
    font: 15px system-ui, sans-serif;
}
.box {
    width: min(360px, 90vw);
    background: #121925;
    border: 1px solid #263346;
    border-radius: 16px;
    padding: 28px;
    text-align: center;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
}
h1 { font-size: 20px; margin: 0 0 8px; }
p { color: #8fa0b8; font-size: 13px; line-height: 1.5; margin: 0 0 22px; }
a.primary {
    display: block;
    background: #5865f2;
    color: #fff;
    text-decoration: none;
    padding: 12px;
    border-radius: 9px;
    font-weight: 700;
}
a.primary:hover { background: #4752c4; }
.small { color: #6b7c93; font-size: 11px; margin-top: 18px; }
.legal { display: flex; justify-content: center; gap: 6px; margin-top: 14px; color: #5f6f84; font-size: 11px; }
.legal a { display: inline; color: #8fa0b8; text-decoration: none; font-weight: 400; }
.legal a:hover { color: #7c9cff; text-decoration: underline; }
`;

const LEGAL_LINKS = String.raw`<a href="https://zebz213.github.io/bootstrapdj-legal/terms.html" target="_blank" rel="noopener noreferrer">Terms</a><span>·</span><a href="https://zebz213.github.io/bootstrapdj-legal/privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a><span>·</span><a href="https://zebz213.github.io/bootstrapdj-legal/" target="_blank" rel="noopener noreferrer">Legal</a>`;

const PLAYER_ICONS = String.raw`<button class="ctrl" data-player="previous" title="Previous" aria-label="Previous"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zM18 6v12l-9-6z"/></svg></button>
<button class="ctrl" id="toggle-btn" data-player="toggle" title="Pause or resume" aria-label="Pause or resume"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="play-icon" d="M8 5v14l11-7z"/><path class="pause-icon" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg></button>
<button class="ctrl" data-player="next" title="Skip" aria-label="Skip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 6h2v12h-2zM6 6v12l9-6z"/></svg></button>
<button class="ctrl" data-player="stop" title="Stop" aria-label="Stop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg></button>
<button class="ctrl" data-player="shuffle" title="Shuffle queue" aria-label="Shuffle queue"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg></button>
<button class="ctrl" id="loop-btn" data-player="loop" title="Cycle loop" aria-label="Cycle loop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm0 10h10v-3l4 4-4 4v-3H5v-6h2v4z"/></svg><span id="loop-label">off</span></button>`;

const VOLUME_CONTROL = String.raw`<label class="volume"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg><input id="volume" type="range" min="0" max="200" step="5" value="100"><span id="volume-label">100%</span></label>`;

/** Full dashboard document. `oauth` switches the client into login-gated mode. */
export function renderDashboard(oauth: boolean): string {
    const bodyAttributes = oauth ? ' data-oauth="1"' : '';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BootstrapDJ dashboard</title>
<style>${STYLES}</style>
</head>
<body${bodyAttributes}>
<header>
  <h1>BootstrapDJ dashboard</h1>
  <div style="display:flex;gap:8px;align-items:center">
    <span id="status" class="small">loading…</span>
    <select id="guild"></select>
    <button id="personal-btn" class="gear" title="My stats" aria-label="Open my stats" style="display:none"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/></svg></button>
    <button id="stats-btn" class="gear" title="Statistics" aria-label="Open statistics"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="14" width="4" height="7" rx="1"/><rect x="10" y="9" width="4" height="12" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/></svg></button>
    <button id="playlists-btn" class="gear" title="Playlists" aria-label="Open playlists"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12v2H4zm0 5h12v2H4zm0 5h12v2H4zm15-8v7.2a2.8 2.8 0 1 1-2-2.6V7l4-1v2z"/></svg></button>
    <button id="settings-btn" class="gear" title="Settings" aria-label="Open settings" style="display:none">⚙</button>
    <button id="logout-btn" class="gear" title="Sign out" aria-label="Sign out" style="display:none"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg></button>
  </div>
</header>
<main>
<section class="panel">
  <div class="player-top"><h2>Player</h2><span id="player-state" class="small"></span><button class="ctrl listen-btn" id="listen-btn" type="button" title="Play this browser's audio from the bot" aria-label="Listen to the bot audio" aria-pressed="false" style="display:none"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/><path class="mute-line" d="M4 4l16 16"/></svg><span id="listen-label">Listen</span></button><button class="ctrl disconnect-btn" id="disconnect-btn" type="button" title="Disconnect dashboard audio" aria-label="Disconnect dashboard audio" style="display:none"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg><span>Disconnect</span></button></div>
  <div id="now-title" class="now">Nothing playing</div>
  <div id="now-meta" class="now-meta"></div>
  <div id="now-time" class="now-time">0:00 / 0:00</div>
  <div class="progress-wrap disabled" id="progress-wrap" role="slider" tabindex="-1" aria-label="Seek through track" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div class="progress" id="progress"><div id="progress-bar"></div></div><span class="progress-tooltip" id="progress-tooltip"></span></div>
  <div class="controls" id="player-controls" style="display:none">
${PLAYER_ICONS}
${VOLUME_CONTROL}
  </div>
  <div class="queue-add" id="queue-add" style="display:none">
    <input id="queue-query" type="text" autocomplete="off" placeholder="Song name or URL" aria-label="Add a song to the queue">
    <button id="queue-add-btn" class="primary" type="button">Add song</button>
  </div>
  <div class="queue-block"><div class="queue-head"><h3>Queue</h3><span id="queue-count" class="small"></span></div><div id="queue-list" class="queue-list"><div class="small">Nothing queued.</div></div></div>
</section>
<section class="panel" id="filters-panel" style="display:none"><h2>Filters</h2><div id="filters" class="filters"></div></section>
</main>
<div id="settings-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
  <div class="modal-card">
    <div class="modal-head"><h2 id="settings-title">Settings</h2><button class="icon-btn" id="settings-close" aria-label="Close settings">✕</button></div>
    <div id="settings" class="settings"></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end"><button class="icon-btn" id="settings-cancel">Cancel</button><button class="primary" id="save">Save settings</button></div>
  </div>
</div>
<div id="stats-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="stats-title">
  <div class="modal-card stats-card">
    <div class="modal-head"><h2 id="stats-title">Statistics</h2><div class="stats-toolbar"><select id="stats-range"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select><button class="icon-btn" id="stats-clear" title="Clear statistics" style="display:none">Clear stats</button><button class="icon-btn" id="stats-close" aria-label="Close statistics">✕</button></div></div>
    <div id="stats-content"></div>
  </div>
</div>
<div id="personal-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="personal-title">
  <div class="modal-card stats-card">
    <div class="modal-head"><h2 id="personal-title">My stats</h2><button class="icon-btn" id="personal-close" aria-label="Close my stats">✕</button></div>
    <div id="personal-content"></div>
  </div>
</div>
<div id="playlists-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="playlists-title">
  <div class="modal-card playlist-card">
    <div class="modal-head"><h2 id="playlists-title">Playlists</h2><button class="icon-btn" id="playlists-close" aria-label="Close playlists">✕</button></div>
    <div class="playlist-create">
      <input id="playlist-name" maxlength="50" placeholder="New playlist name" aria-label="New playlist name">
      <button id="playlist-create" class="primary">Create playlist</button>
    </div>
    <div class="playlist-layout">
      <div id="playlist-list" class="playlist-list"><div class="small">Loading playlists…</div></div>
      <div id="playlist-detail" class="playlist-detail"><div class="small">Select a playlist to edit or load it.</div></div>
    </div>
  </div>
</div>
<div id="toast"></div>
<footer>
  <span>© 2026 BootstrapBoys</span><span class="sep">·</span>
  <a href="https://zebz213.github.io/bootstrapdj-legal/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a><span class="sep">·</span>
  <a href="https://zebz213.github.io/bootstrapdj-legal/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a><span class="sep">·</span>
  <a href="https://zebz213.github.io/bootstrapdj-legal/" target="_blank" rel="noopener noreferrer">Legal</a>
</footer>
<script>${BROWSER_SCRIPT}</script>
</body>
</html>`;
}

/** Standalone sign-in screen shown before the OAuth callback completes. */
export function renderLoginPage(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BootstrapDJ — Login</title>
<style>${LOGIN_STYLES}</style>
</head>
<body>
<div class="box">
  <h1>BootstrapDJ Dashboard</h1>
  <p>Sign in with Discord. Dashboard access is limited to members of servers with this bot.</p>
  <a class="primary" href="/auth/discord">Continue with Discord</a>
  <div class="small">Members of servers with BootstrapDJ</div>
  <div class="legal">${LEGAL_LINKS}</div>
</div>
</body>
</html>`;
}
