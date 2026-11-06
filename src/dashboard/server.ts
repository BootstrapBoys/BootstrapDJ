import type Dispatcher from '../structures/Dispatcher.js';
import type { BootstrapClient } from '../structures/index.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import config from '../config.js';
import { AUTOPLAY_FIELDS, DEFAULTS, isKnownSetting } from '../utils/SettingsSchema.js';

type FilterDef = {
    id: string;
    label: string;
    description: string;
    value?: { min: number; max: number; step: number; fallback: number };
    activeName?: string;
    enable: (player: Dispatcher, value: number) => void;
    disable: (player: Dispatcher) => void;
};

const FILTERS: FilterDef[] = [
    {
        id: '8d',
        label: '8D',
        description: 'Rotating stereo image',
        activeName: '8D',
        enable: player => player.player.setRotation({ rotationHz: 0.2 }),
        disable: player => player.player.setRotation(),
    },
    {
        id: 'bassboost',
        label: 'Bass boost',
        description: 'Low-band equalizer lift',
        activeName: 'bassboost',
        enable: player =>
            player.player.setEqualizer([
                { band: 0, gain: 0.34 },
                { band: 1, gain: 0.34 },
                { band: 2, gain: 0.34 },
                { band: 3, gain: 0.34 },
            ]),
        disable: player => player.player.setEqualizer([]),
    },
    {
        id: 'distortion',
        label: 'Distortion',
        description: 'Soft distortion effect',
        activeName: 'distorsion',
        enable: player =>
            player.player.setDistortion({
                sinOffset: 0,
                sinScale: 1,
                cosOffset: 0,
                cosScale: 1,
                tanOffset: 0,
                tanScale: 1,
                offset: 0,
                scale: 1,
            }),
        disable: player => player.player.setDistortion({}),
    },
    {
        id: 'karaoke',
        label: 'Karaoke',
        description: 'Remove center vocals',
        activeName: 'karaoke',
        enable: player => player.player.setKaraoke({ level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }),
        disable: player => player.player.setKaraoke(),
    },
    {
        id: 'nightcore',
        label: 'Nightcore',
        description: 'Faster, higher-pitched playback',
        activeName: 'nightcore',
        enable: player => player.player.setTimescale({ speed: 1.165, pitch: 1.125, rate: 1.05 }),
        disable: player => player.player.setTimescale(),
    },
    {
        id: 'rotation',
        label: 'Rotation',
        description: 'Rotating channel effect',
        activeName: 'rotation',
        enable: player => player.player.setRotation({ rotationHz: 0 }),
        disable: player => player.player.setRotation(),
    },
    {
        id: 'tremolo',
        label: 'Tremolo',
        description: 'Amplitude modulation',
        activeName: 'tremolo',
        enable: player => player.player.setTremolo({ depth: 0.75, frequency: 4 }),
        disable: player => player.player.setTremolo(),
    },
    {
        id: 'vibrato',
        label: 'Vibrato',
        description: 'Pitch modulation',
        activeName: 'vibrato',
        enable: player => player.player.setVibrato({ depth: 0.75, frequency: 4 }),
        disable: player => player.player.setVibrato(),
    },
    {
        id: 'lowpass',
        label: 'Low pass',
        description: 'Smooth high frequencies',
        activeName: 'lowpass',
        enable: player => player.player.setLowPass({ smoothing: 20 }),
        disable: player => player.player.setLowPass({}),
    },
    {
        id: 'pitch',
        label: 'Pitch',
        description: 'Set pitch multiplier',
        value: { min: 1, max: 5, step: 0.05, fallback: 1 },
        activeName: 'pitch',
        enable: (player, value) => player.player.setTimescale({ pitch: value, rate: 1, speed: 1 }),
        disable: player => player.player.setTimescale(),
    },
    {
        id: 'rate',
        label: 'Rate',
        description: 'Set playback rate',
        value: { min: 0.5, max: 5, step: 0.05, fallback: 1 },
        activeName: 'rate',
        enable: (player, value) => player.player.setTimescale({ rate: value, pitch: value, speed: 1 }),
        disable: player => player.player.setTimescale(),
    },
    {
        id: 'speed',
        label: 'Speed',
        description: 'Set playback speed',
        value: { min: 0.5, max: 5, step: 0.05, fallback: 1 },
        activeName: 'speed',
        enable: (player, value) => player.player.setTimescale({ speed: value }),
        disable: player => player.player.setTimescale(),
    },
];

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BootstrapDJ dashboard</title>
<style>
:root{color-scheme:dark;--bg:#111318;--panel:#191d25;--panel2:#222834;--text:#eef1f6;--muted:#9aa7b8;--accent:#7c9cff;--ok:#55d68b;--bad:#ff7272}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,Segoe UI,sans-serif}
header{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2b3340}
h1{font-size:18px;margin:0;letter-spacing:.2px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 10px}
main{max-width:1100px;margin:0 auto;padding:22px;display:grid;gap:18px}
.panel{background:var(--panel);border:1px solid #2b3340;border-radius:12px;padding:16px}
select,input,button{background:var(--panel2);color:var(--text);border:1px solid #394556;border-radius:8px;padding:8px 10px;font:inherit}
button{cursor:pointer}button.primary{background:var(--accent);color:#0d1220;border-color:var(--accent);font-weight:650}
.filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
.filter{display:flex;gap:10px;align-items:flex-start;background:var(--panel2);border:1px solid #2f3948;border-radius:10px;padding:11px}
.filter label{display:flex;gap:9px;align-items:center;flex:1;cursor:pointer}.filter input[type=checkbox]{accent-color:var(--accent);width:18px;height:18px}
.small{font-size:12px;color:var(--muted)}.filter .value{width:84px;padding:6px;margin-top:6px}
.player-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.player-top h2{margin:0}
.now{font-size:18px;font-weight:650;margin:10px 0 2px}.now-meta{color:var(--muted);font-size:13px}.now-time{color:var(--text);font-size:13px;font-weight:600;margin-top:3px;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.progress{height:6px;background:#2b3340;border-radius:99px;overflow:hidden;margin:12px 0}.progress>div{height:100%;width:100%;background:var(--accent);transform:scaleX(0);transform-origin:left;will-change:transform}
.controls{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:12px 0 16px}
.ctrl{background:var(--panel2);border:1px solid #394556;color:var(--text);border-radius:9px;min-width:38px;padding:8px 10px;font-size:15px}.ctrl:hover{border-color:var(--accent)}.ctrl.on{border-color:var(--accent);color:var(--accent)}
.volume{display:flex;gap:7px;align-items:center;color:var(--muted);font-size:12px;margin-left:auto}.volume input{width:110px;accent-color:var(--accent)}
.queue-block{border-top:1px solid #2f3948;padding-top:12px}.queue-head{display:flex;justify-content:space-between;align-items:baseline}.queue-head h3{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:0 0 8px}
.queue-list{display:grid;gap:5px;max-height:260px;overflow:auto}.queue-item{display:flex;gap:10px;align-items:baseline;padding:7px 9px;background:var(--panel2);border-radius:7px;font-size:13px;cursor:pointer}.queue-item:hover{border:1px solid var(--accent);padding:6px 8px}.queue-item .qpos{color:var(--muted);width:20px;flex:none}.queue-item .qtitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.queue-item .qmeta{color:var(--muted);font-size:12px;flex:none}
.settings{display:grid;gap:18px}
.settings-group{border-top:1px solid #2f3948;padding-top:13px}.settings-group:first-child{border-top:0;padding-top:0}
.settings-group h3{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--accent);margin:0 0 9px}
.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.setting{display:grid;gap:5px}.setting input,.setting select{width:100%}
.setting-label{display:flex;align-items:center;gap:6px;min-width:0}
.help{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1px solid #4b5a6e;border-radius:50%;color:var(--muted);font-size:10px;font-weight:700;cursor:help;flex:none;outline:none}
.help:hover,.help:focus{color:var(--accent);border-color:var(--accent)}
.help::after{content:attr(data-tip);position:absolute;left:0;top:22px;width:max-content;max-width:260px;white-space:normal;background:#0b0f17;border:1px solid #4b5a6e;color:var(--text);padding:8px 10px;border-radius:7px;font-size:12px;line-height:1.35;font-weight:400;z-index:30;opacity:0;pointer-events:none;transform:translateY(-3px);transition:opacity .12s,transform .12s;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.help:hover::after,.help:focus::after{opacity:1;transform:translateY(0)}
.setting.wide{grid-column:1/-1}
.autoplay-reset{margin-top:9px;background:transparent;border-color:#394556;color:var(--muted);padding:6px 9px;font-size:12px}
.status{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:13px}.status b{color:var(--text)}
#toast{position:fixed;right:18px;bottom:18px;padding:10px 14px;border-radius:9px;background:var(--panel2);border:1px solid #394556;opacity:0;transition:.2s}
#toast.show{opacity:1}.error{color:var(--bad)}.ok{color:var(--ok)}
.gear{background:transparent;border-color:transparent;color:var(--muted);font-size:22px;line-height:1;padding:6px 9px;border-radius:8px}.gear:hover{color:var(--text);background:var(--panel2);border-color:#394556}
.modal{position:fixed;inset:0;background:rgba(5,8,14,.72);display:none;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto;z-index:20}.modal.open{display:flex}
.modal-card{width:min(980px,100%);background:var(--panel);border:1px solid #394556;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:18px}
.modal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.modal-head h2{margin:0;color:var(--text);font-size:16px;text-transform:none;letter-spacing:0}
.icon-btn{background:var(--panel2);border:1px solid #394556;color:var(--text);border-radius:8px;padding:7px 10px;cursor:pointer}

@media (max-width: 680px){
  body{font-size:14px}
  header{flex-direction:column;align-items:stretch;padding:14px 14px 12px;gap:10px}
  header > div{width:100%;flex-wrap:wrap}
  header h1{font-size:17px}
  #guild{flex:1;min-width:0}
  .gear{font-size:24px;padding:8px 11px;min-height:44px}
  main{padding:12px;gap:12px}
  .panel{padding:13px;border-radius:10px}
  .now{font-size:16px;margin-top:8px}
  .controls{gap:6px}
  .ctrl{min-width:44px;min-height:44px;padding:8px}
  .volume{margin-left:0;width:100%;justify-content:space-between;order:10;margin-top:3px}
  .volume input{flex:1;width:auto}
  .queue-list{max-height:220px}
  .queue-item{font-size:12px;padding:7px}
  .queue-item .qmeta{font-size:11px;max-width:42%;overflow:hidden;text-overflow:ellipsis}
  .filters{grid-template-columns:1fr}
  .settings{display:block}
  .settings-group{margin-bottom:16px}
  .settings-grid{grid-template-columns:1fr}
  .setting.wide{grid-column:auto}
  .modal{padding:0;align-items:flex-end}
  .modal-card{width:100%;max-height:94vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px 14px 20px}
  .modal-head{position:sticky;top:0;background:var(--panel);z-index:2;padding-bottom:10px}
  .icon-btn,.primary{min-height:42px}
}
@media (max-width: 380px){
  header h1{font-size:16px}
  .ctrl{min-width:40px}
  .now{font-size:15px}
}
.gear svg{width:22px;height:22px;display:block;fill:currentColor}
.stats-card{width:min(1120px,100%)}.stats-toolbar{display:flex;gap:8px;align-items:center}.stats-toolbar select{padding:7px 9px}
.stat-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px}
.stat-card{background:var(--panel2);border:1px solid #2f3948;border-radius:10px;padding:12px}.stat-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.stat-value{font-size:24px;font-weight:700;margin-top:5px;font-variant-numeric:tabular-nums}
.stats-grid{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:14px}.stats-grid.two{grid-template-columns:1fr 1fr}.stats-block{background:var(--panel2);border:1px solid #2f3948;border-radius:10px;padding:12px;min-width:0}.stats-block h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 10px}
.bars{display:flex;align-items:flex-end;gap:4px;height:150px}.bar-wrap{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;flex:1;height:100%;min-width:0}.bar{width:100%;max-width:28px;background:linear-gradient(180deg,var(--accent),#4d6bd6);border-radius:4px 4px 0 0;min-height:2px}.bar-label{font-size:10px;color:var(--muted);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.pie{width:170px;height:170px;border-radius:50%;margin:6px auto 12px;position:relative}.pie.empty{background:var(--panel);border:1px dashed #394556}.legend{display:grid;gap:5px;font-size:12px;color:var(--muted)}.legend span{display:flex;align-items:center;gap:7px}.dot{width:9px;height:9px;border-radius:3px;display:inline-block;flex:none}
.stat-list{display:grid;gap:5px}.stat-row{display:flex;gap:9px;align-items:center;background:var(--panel);border-radius:7px;padding:8px 9px;font-size:13px;min-width:0}.stat-index{color:var(--muted);width:18px;flex:none}.stat-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stat-sub{color:var(--muted);font-size:11px}.stat-avatar{width:22px;height:22px;border-radius:50%;background:var(--panel2);flex:none;object-fit:cover}
.service-icon{width:16px;height:16px;object-fit:contain;vertical-align:-3px;margin-right:6px;border-radius:3px}
.stat-main a{color:var(--text);text-decoration:none}.stat-main a:hover{color:var(--accent);text-decoration:underline}
@media (max-width: 680px){.stats-grid,.stats-grid.two{grid-template-columns:1fr}.stats-card{max-height:94vh;overflow:auto}.stat-value{font-size:20px}.bar-label{display:none}}
</style>
</head>
<body>
<header><h1>BootstrapDJ dashboard</h1><div style="display:flex;gap:8px;align-items:center"><span id="status" class="small">loading…</span><select id="guild"></select><button id="stats-btn" class="gear" title="Statistics" aria-label="Open statistics"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="14" width="4" height="7" rx="1"/><rect x="10" y="9" width="4" height="12" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/></svg></button><button id="settings-btn" class="gear" title="Settings" aria-label="Open settings">⚙</button></div></header>
<main>
<section class="panel">
<div class="player-top"><h2>Player</h2><span id="player-state" class="small"></span></div>
<div id="now-title" class="now">Nothing playing</div>
<div id="now-meta" class="now-meta"></div>
<div id="now-time" class="now-time">0:00 / 0:00</div>
<div class="progress"><div id="progress-bar"></div></div>
<div class="controls">
<button class="ctrl" data-player="previous" title="Previous">⏮</button>
<button class="ctrl" data-player="toggle" title="Pause or resume">⏯</button>
<button class="ctrl" data-player="next" title="Skip">⏭</button>
<button class="ctrl" data-player="stop" title="Stop">⏹</button>
<button class="ctrl" data-player="shuffle" title="Shuffle queue">🔀</button>
<button class="ctrl" id="loop-btn" data-player="loop" title="Cycle loop">Loop: off</button>
<label class="volume">🔊 <input id="volume" type="range" min="0" max="200" step="1" value="100"><span id="volume-label">100%</span></label>
</div>
<div class="queue-block"><div class="queue-head"><h3>Queue</h3><span id="queue-count" class="small"></span></div><div id="queue-list" class="queue-list"><div class="small">Nothing queued.</div></div></div>
</section>
<section class="panel"><h2>Filters</h2><div id="filters" class="filters"></div></section>
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
    <div class="modal-head"><h2 id="stats-title">Statistics</h2><div class="stats-toolbar"><select id="stats-range"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select><button class="icon-btn" id="stats-clear" title="Clear statistics">Clear stats</button><button class="icon-btn" id="stats-close" aria-label="Close statistics">✕</button></div></div>
    <div id="stats-content"></div>
  </div>
</div>
<div id="toast"></div>
<script>
const state={guildId:null,data:null,viewer:{owner:true,admin:true},queueKey:null};
const $=s=>document.querySelector(s);
function token(){return localStorage.getItem('bootstrapdj-dashboard-token')||''}
function headers(json){const h={'x-dashboard-token':token()};if(json)h['content-type']='application/json';return h}
function toast(text,isError){const el=$('#toast');el.textContent=text;el.className='show '+(isError?'error':'ok');setTimeout(()=>el.className='',2500)}
async function api(path,options){const res=await fetch(path,{...options,headers:{...headers(Boolean(options&&options.body)),...(options&&options.headers)}});if(res.status===401){if(document.body.dataset.oauth==='1'){location.href='/auth/discord';throw new Error('Login required')}const t=prompt('Dashboard token');if(t){localStorage.setItem('bootstrapdj-dashboard-token',t);return api(path,options)}}if(!res.ok)throw new Error((await res.text())||res.statusText);return res.json()}
async function boot(){const g=await api('/api/guilds');state.viewer=g.viewer||state.viewer;$('#stats-clear').style.display=state.viewer.owner?'':'none';const sel=$('#guild');sel.innerHTML='';for(const guild of g.guilds){const o=document.createElement('option');o.value=guild.id;o.textContent=guild.name;sel.appendChild(o)}if(!g.guilds.length){$('#status').textContent='No guilds';return}state.guildId=g.guilds[0].id;sel.value=state.guildId;sel.onchange=()=>{state.guildId=sel.value;load()};await load()}
async function load(){try{state.data=await api('/api/state?guildId='+encodeURIComponent(state.guildId));render();$('#status').textContent='Connected'}catch(e){$('#status').textContent='Error';toast(e.message,true)}}
const GROUPS=[
{title:'Playback',keys:['defaultvolume','defaultautoplay','defaultrepeat','defaultshuffle','searchtype','maxqueue','maxuserqueue','voteskip','voteskippercent','autocorrect','volumeautomatic','loudnesstarget']},
{title:'Autoplay',keys:['autoplaysource','autoplayseeds']},
{title:'Responses',keys:['ephemeral','announce','announcechannel','deleteafter']},
{title:'Limits',keys:['maxtracklength','mintracklength','maxusertracks','maxusertrackslength','maxplaylisttracks','maxplaylistlength','timeoutlisteners','timeoutpause','timeoutplaying','timeoutconfirmation']},
{title:'Access and channels',keys:['locked','allowthreads','commandchannel','voicechannel','disabledcommands']}
];
const LABELS={defaultvolume:'Default volume',defaultautoplay:'Default autoplay',defaultrepeat:'Default repeat',defaultshuffle:'Default shuffle',searchtype:'Search engine',maxqueue:'Max queue size',maxuserqueue:'Max per-user queue',voteskip:'Vote skip enabled',voteskippercent:'Vote skip percent',autocorrect:'Autocorrect suggestions',volumeautomatic:'Automatic volume',loudnesstarget:'Target loudness (LUFS)',autoplaysource:'Source',autoplayseeds:'Curated seeds',announce:'Text announcements',announcechannel:'Announcement channel ID',ephemeral:'Ephemeral slash replies',deleteafter:'Reply delete after (s)',maxtracklength:'Max track length (s)',mintracklength:'Min track length (s)',maxusertracks:'Max user tracks',maxusertrackslength:'Max user track length (s)',maxplaylisttracks:'Max playlist tracks',maxplaylistlength:'Max playlist length (s)',locked:'Session locked',allowthreads:'Commands in threads',timeoutlisteners:'Listener timeout (s)',timeoutpause:'Pause timeout (s)',timeoutplaying:'Idle playback timeout (s)',timeoutconfirmation:'Confirmation prompt (s)',commandchannel:'Command channel ID',voicechannel:'Required voice channel ID',disabledcommands:'Disabled commands'};
const DESCRIPTIONS={
defaultvolume:'Base volume for new tracks. Adaptive loudness uses this as the gain reference.',
defaultautoplay:'Start autoplay automatically when a queue ends.',
defaultrepeat:'Default loop mode for new sessions: off, repeat current, or queue.',
defaultshuffle:'Shuffle the queue when a new session starts.',
searchtype:'Lavalink search prefix for slash commands, such as dzsearch, ytsearch, ytmsearch, or scsearch. Prefix commands use PREFIX_SEARCH_ENGINE.',
maxqueue:'Maximum number of tracks allowed in the queue.',
maxuserqueue:'Maximum queue slots reserved per user.',
voteskip:'Allow members to start a vote-skip.',
voteskippercent:'Percentage of listeners required to pass a vote-skip.',
autocorrect:'Correct a mistyped prefix command to the closest command and run it.',
volumeautomatic:'Analyze track loudness and adjust volume toward the target LUFS.',
loudnesstarget:'Target integrated loudness in LUFS. -16 is a common music target.',
autoplaysource:'Cold-start source: Deezer chart, curated seeds, or the legacy seed value.',
autoplayseeds:'Comma-separated search phrases used when the autoplay source is curated.',
announce:'Post a text announcement when a track starts.',
ephemeral:'Make slash command replies private. Set false for normal public messages. Prefix replies are always normal messages.',
announcechannel:'Text channel ID for announcements. Leave blank to disable the extra message.',
deleteafter:'Seconds before command replies are deleted. 0 disables auto-delete.',
maxtracklength:'Reject tracks longer than this many seconds. 0 disables the limit.',
mintracklength:'Reject tracks shorter than this many seconds. 0 disables the minimum.',
maxusertracks:'Maximum queued tracks from one user. 0 disables the limit.',
maxusertrackslength:'Maximum total seconds one user may have queued. 0 disables the limit.',
maxplaylisttracks:'Maximum tracks accepted from one playlist. 0 disables the limit.',
maxplaylistlength:'Maximum total duration accepted from one playlist, in seconds. 0 disables the limit.',
timeoutlisteners:'Disconnect after this many seconds with no listeners. 0 disables.',
timeoutpause:'Disconnect after this many seconds paused. 0 disables.',
timeoutplaying:'Disconnect after this many seconds with an empty queue. 0 disables.',
timeoutconfirmation:'Ask “Still listening?” after this many seconds. 0 disables the prompt.',
locked:'Lock the session so only server managers can change settings or use commands.',
allowthreads:'Allow commands inside threads.',
commandchannel:'Restrict commands to this text channel ID. Blank allows all channels.',
voicechannel:'Require command users to be in this voice channel ID. Blank disables the requirement.',
disabledcommands:'Comma-separated command names that are disabled in this server.'
};
const BOOLS=new Set(['defaultautoplay','defaultshuffle','voteskip','announce','ephemeral','autocorrect','volumeautomatic','locked','allowthreads']);
const LONG=new Set(['autoplayseeds','disabledcommands','announcechannel','commandchannel','voicechannel']);
function field(key,value){const box=document.createElement('label');box.className='setting'+(LONG.has(key)?' wide':'');const title=document.createElement('span');title.className='setting-label small';const titleText=document.createElement('span');titleText.textContent=LABELS[key]||key;title.appendChild(titleText);if(DESCRIPTIONS[key]){const help=document.createElement('span');help.className='help';help.textContent='?';help.tabIndex=0;help.setAttribute('role','note');help.setAttribute('aria-label',DESCRIPTIONS[key]);help.dataset.tip=DESCRIPTIONS[key];title.appendChild(help)}box.appendChild(title);let input;if(key==='autoplaysource'){input=document.createElement('select');for(const v of ['chart','curated','legacy']){const o=document.createElement('option');o.value=v;o.textContent=v;input.appendChild(o)}input.value=value||'chart'}else if(BOOLS.has(key)){input=document.createElement('select');for(const v of ['true','false']){const o=document.createElement('option');o.value=v;o.textContent=v;input.appendChild(o)}input.value=value==='true'?'true':'false'}else{input=document.createElement('input');input.value=value;input.type=['defaultvolume','maxqueue','maxuserqueue','voteskippercent','deleteafter','maxtracklength','mintracklength','maxusertracks','maxusertrackslength','maxplaylisttracks','maxplaylistlength','loudnesstarget','timeoutlisteners','timeoutpause','timeoutplaying','timeoutconfirmation'].includes(key)?'number':'text'}input.dataset.key=key;box.appendChild(input);return box}
async function refreshPlayer(){const guildId=state.guildId;if(!guildId)return;try{const d=await api('/api/player-state?guildId='+encodeURIComponent(guildId));if(state.guildId!==guildId)return;state.data.player=d.player;renderPlayer(d)}catch(e){}}
let progress={track:'',serverPosition:0,position:0,duration:0,at:0,paused:true};
function drawProgress(){const p=state.data&&state.data.player;if(!p)return;const elapsed=progress.paused?0:Date.now()-progress.at;const position=progress.duration>0?Math.min(progress.duration,progress.position+elapsed):progress.position+elapsed;const percent=progress.duration>0?Math.max(0,Math.min(100,(position/progress.duration)*100)):0;$('#progress-bar').style.transform='scaleX('+(percent/100)+')';$('#now-time').textContent=formatMs(position)+' / '+(progress.duration?formatMs(progress.duration):'LIVE')}
function renderPlayer(d){const p=d.player;const title=$('#now-title'),meta=$('#now-meta'),stateEl=$('#player-state'),list=$('#queue-list'),count=$('#queue-count');if(!p){state.queueKey=null;title.textContent='Nothing playing';meta.textContent='';progress={track:'',serverPosition:0,position:0,duration:0,at:Date.now(),paused:true};$('#progress-bar').style.transform='scaleX(0)';$('#now-time').textContent='0:00 / 0:00';stateEl.textContent='idle';list.innerHTML='<div class="small">Nothing queued.</div>';count.textContent='';$('#volume').value=100;$('#volume-label').textContent='100%';$('#loop-btn').textContent='Loop: off';return}title.textContent=p.title||'Nothing playing';meta.textContent=p.author||'';const nextPosition=p.position||0;const nextDuration=p.duration||0;const nextPaused=Boolean(p.paused);const trackKey=(p.title||'')+'|'+(p.author||'')+'|'+nextDuration;
const estimated=progress.paused?progress.position:progress.position+(Date.now()-progress.at);
const trackChanged=!progress.track||progress.track!==trackKey;
const serverChanged=nextPosition!==progress.serverPosition;
const jumpedBack=nextPosition<progress.serverPosition-1500;
const jumpedForward=nextPosition>progress.serverPosition+8000;
const drifted=serverChanged&&Math.abs(nextPosition-estimated)>2000;
if(trackChanged||nextPaused!==progress.paused||nextDuration!==progress.duration||jumpedBack||jumpedForward||drifted){progress={track:trackKey,serverPosition:nextPosition,position:nextPaused?estimated:nextPosition,duration:nextDuration,at:Date.now(),paused:nextPaused}}else{progress.serverPosition=nextPosition}
drawProgress();stateEl.textContent=(p.paused?'paused':'playing')+(p.autoplay?' · autoplay':'');$('#volume').value=p.volume??100;$('#volume-label').textContent=($('#volume').value)+'%';const loop=$('#loop-btn');loop.textContent='Loop: '+p.loop;loop.classList.toggle('on',p.loop!=='off');count.textContent=p.queueLength+' queued';const queueKey=(p.queueLength||0)+'|'+(p.upcoming||[]).map(t=>t.position+':'+t.title+':'+(t.author||'')).join('|');if(state.queueKey!==queueKey){state.queueKey=queueKey;list.innerHTML='';if(!p.upcoming||!p.upcoming.length){list.innerHTML='<div class="small">Nothing queued.</div>'}else{for(const t of p.upcoming){const row=document.createElement('div');row.className='queue-item';const pos=document.createElement('span');pos.className='qpos';pos.textContent=t.position;const name=document.createElement('span');name.className='qtitle';name.textContent=t.title;const meta2=document.createElement('span');meta2.className='qmeta';meta2.textContent=(t.author||'')+(t.duration?' · '+formatMs(t.duration):'');row.append(pos,name,meta2);row.title='Skip to '+t.title;row.tabIndex=0;row.role='button';row.onclick=()=>playerAction('jump',t.position);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();playerAction('jump',t.position)}};list.appendChild(row)}}}}
function formatMs(ms){const s=Math.max(0,Math.floor(ms/1000));const m=Math.floor(s/60);const h=Math.floor(m/60);return h?h+':'+String(m%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0'):m+':'+String(s%60).padStart(2,'0')}
function render(){const d=state.data;renderPlayer(d);
 const wrap=$('#filters');wrap.innerHTML='';for(const f of d.filters){const row=document.createElement('div');row.className='filter';const active=f.active;const label=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.checked=active;cb.onchange=()=>toggleFilter(f.id,cb.checked,row);label.appendChild(cb);const span=document.createElement('span');span.textContent=f.label;label.appendChild(span);row.appendChild(label);if(f.value){const input=document.createElement('input');input.type='number';input.className='value';input.min=f.value.min;input.max=f.value.max;input.step=f.value.step;input.value=f.current??f.value.fallback;input.onchange=()=>{if(cb.checked)toggleFilter(f.id,true,row,input.value)};row.appendChild(input)}wrap.appendChild(row)}
 const s=$('#settings');s.innerHTML='';const seen=new Set();for(const group of GROUPS){const section=document.createElement('section');section.className='settings-group';const heading=document.createElement('h3');heading.textContent=group.title;section.appendChild(heading);const grid=document.createElement('div');grid.className='settings-grid';for(const key of group.keys){if(!(key in d.settings))continue;seen.add(key);grid.appendChild(field(key,d.settings[key]))}section.appendChild(grid);if(group.title==='Autoplay'){const reset=document.createElement('button');reset.className='autoplay-reset';reset.textContent='Reset autoplay override';reset.onclick=async()=>{try{await api('/api/settings',{method:'POST',body:JSON.stringify({guildId:state.guildId,key:'autoplayreset',value:'true'})});await load();toast('Autoplay override reset')}catch(e){toast(e.message,true)}};section.appendChild(reset)}s.appendChild(section)}const rest=Object.keys(d.settings).filter(key=>!seen.has(key));if(rest.length){const section=document.createElement('section');section.className='settings-group';const heading=document.createElement('h3');heading.textContent='Other';section.appendChild(heading);const grid=document.createElement('div');grid.className='settings-grid';for(const key of rest)grid.appendChild(field(key,d.settings[key]));section.appendChild(grid);s.appendChild(section)}}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function toggleFilter(id,enabled,row,value){try{await api('/api/filter',{method:'POST',body:JSON.stringify({guildId:state.guildId,filter:id,enabled,value:value===undefined?undefined:Number(value)})});await load();toast((enabled?'Enabled ':'Disabled ')+id)}catch(e){toast(e.message,true);if(row)row.classList.add('error')}}
const modal=$('#settings-modal');
function openSettings(){modal.classList.add('open')}
function closeSettings(){modal.classList.remove('open')}
$('#settings-btn').onclick=openSettings;
$('#settings-close').onclick=closeSettings;
$('#settings-cancel').onclick=closeSettings;
modal.addEventListener('click',e=>{if(e.target===modal)closeSettings()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSettings();closeStats()}});
async function playerAction(action,value){try{await api('/api/player',{method:'POST',body:JSON.stringify({guildId:state.guildId,action,value})});await load()}catch(e){toast(e.message,true)}}
document.querySelectorAll('[data-player]').forEach(button=>button.onclick=()=>playerAction(button.dataset.player));
$('#volume').onchange=()=>{const value=Number($('#volume').value);$('#volume-label').textContent=value+'%';playerAction('volume',value)};
$('#volume').oninput=()=>{$('#volume-label').textContent=$('#volume').value+'%'};
const statsModal=$('#stats-modal');
function fmtSeconds(value){const s=Math.max(0,Math.round(value));const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const sec=s%60;return h?h+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0'):m+':'+String(sec).padStart(2,'0')}
function bars(values,labels,unit){const max=Math.max(1,...values);return '<div class="bars">'+values.map((value,index)=>'<div class="bar-wrap"><div class="bar" style="height:'+Math.max(2,Math.round((value/max)*100))+'%" title="'+escapeHtml(labels[index])+': '+escapeHtml(unit?fmtSeconds(value):String(value))+'"></div><span class="bar-label">'+escapeHtml(labels[index])+'</span></div>').join('')+'</div>'}
function statList(rows){return '<div class="stat-list">'+(rows.length?rows.map((row,index)=>'<div class="stat-row"><span class="stat-index">'+(index+1)+'</span>'+row+'</div>').join(''):'<div class="small">No data yet.</div>')+'</div>'}
function renderStats(d){const el=$('#stats-content');const totalSeconds=d.totals.seconds;const sourceTotal=d.sources.reduce((sum,item)=>sum+item.seconds,0);const colors=['#55d68b','#7c9cff','#ffb454','#ff7272','#c084fc','#5eead4'];const pie=d.sources.length&&sourceTotal?('conic-gradient('+d.sources.map((item,index)=>{const start=d.sources.slice(0,index).reduce((sum,x)=>sum+x.seconds,0)/sourceTotal*100;const end=(d.sources.slice(0,index+1).reduce((sum,x)=>sum+x.seconds,0)/sourceTotal*100);return colors[index%colors.length]+' '+start+'% '+end+'%'}).join(',')+')'):'';
el.innerHTML='<div class="stat-cards"><div class="stat-card"><div class="stat-label">Listening time</div><div class="stat-value">'+fmtSeconds(totalSeconds)+'</div></div><div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value">'+d.totals.sessions+'</div></div><div class="stat-card"><div class="stat-label">Game sessions</div><div class="stat-value">'+d.totals.gameSessions+'</div></div><div class="stat-card"><div class="stat-label">Sources</div><div class="stat-value">'+d.sources.length+'</div></div></div>'+
'<div class="stats-grid"><div class="stats-block"><h3>Listening time by day</h3>'+bars(d.days.map(x=>x.seconds),d.days.map(x=>x.day.slice(5)),true)+'</div><div class="stats-block"><h3>Track types</h3><div class="pie '+(pie?'':'empty')+'" style="'+(pie?'background:'+pie:'')+'"></div><div class="legend">'+(d.sources.length?d.sources.map((item,index)=>'<span><i class="dot" style="background:'+colors[index%colors.length]+'"></i>'+(item.icon?'<img class="service-icon" src="'+escapeHtml(item.icon)+'" alt="">':'')+escapeHtml(item.source)+' — '+fmtSeconds(item.seconds)+'</span>').join(''):'<span>No tracks yet.</span>')+'</div></div></div>'+
'<div class="stats-grid two"><div class="stats-block"><h3>Listening time by hour</h3>'+bars(d.hours.map(x=>x.seconds),d.hours.map(x=>String(x.hour).padStart(2,'0')+':00'),true)+'</div><div class="stats-block"><h3>Listening time by weekday</h3>'+bars(d.weekdays.map(x=>x.seconds),['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],true)+'</div></div>'+
'<div class="stats-grid two"><div class="stats-block"><h3>Most time played</h3>'+statList(d.topTracks.map(item=>{const label=escapeHtml(item.title);const linked=item.uri&&/^https?:/i.test(item.uri)?'<a href="'+escapeHtml(item.uri)+'" target="_blank" rel="noopener">'+label+'</a>':label;const icon=item.icon?'<img class="service-icon" src="'+escapeHtml(item.icon)+'" alt="">':'';return '<span class="stat-main">'+icon+linked+'<br><span class="stat-sub">'+escapeHtml(item.author)+' · '+fmtSeconds(item.seconds)+'</span></span>'}))+'</div><div class="stats-block"><h3>Most time listened</h3>'+statList(d.topListeners.map(item=>'<img class="stat-avatar" src="'+escapeHtml(item.avatar||'')+'" alt="">'+'<span class="stat-main">'+escapeHtml(item.name||item.userId)+'<br><span class="stat-sub">'+fmtSeconds(item.seconds)+'</span></span>'))+'</div></div>'+
'<div class="stats-block"><h3>Top commands</h3>'+statList(d.topCommands.map(item=>'<span class="stat-main">'+escapeHtml(item.command)+'<br><span class="stat-sub">'+item.count+' uses</span></span>'))+'</div>'}
$('#stats-clear').onclick=async()=>{if(!state.guildId)return;if(!confirm('Clear all statistics and game scores for this server? This cannot be undone.'))return;try{await api('/api/stats/clear',{method:'POST',body:JSON.stringify({guildId:state.guildId})});toast('Statistics cleared');await loadStats()}catch(e){toast(e.message,true)}};
async function loadStats(){if(!state.guildId)return;const content=$('#stats-content');content.innerHTML='<div class="small">Loading statistics…</div>';try{const days=$('#stats-range').value;const d=await api('/api/stats?guildId='+encodeURIComponent(state.guildId)+'&days='+days);renderStats(d)}catch(e){content.innerHTML='<div class="error">'+escapeHtml(e.message)+'</div>'}}
function openStats(){statsModal.classList.add('open');loadStats()}
function closeStats(){statsModal.classList.remove('open')}
$('#stats-btn').onclick=openStats;
$('#stats-close').onclick=closeStats;
$('#stats-range').onchange=loadStats;
statsModal.addEventListener('click',e=>{if(e.target===statsModal)closeStats()});
$('#save').onclick=async()=>{const values={};for(const el of document.querySelectorAll('#settings input, #settings select'))values[el.dataset.key]=el.value;try{await api('/api/settings',{method:'POST',body:JSON.stringify({guildId:state.guildId,settings:values})});await load();toast('Settings saved')}catch(e){toast(e.message,true)}};
boot().catch(e=>{$('#status').textContent='Error';toast(e.message,true)});
setInterval(refreshPlayer,1000);
function progressFrame(){drawProgress();requestAnimationFrame(progressFrame)}requestAnimationFrame(progressFrame);
</script>
</body></html>`;

type DashboardSession = { id: string; name: string; avatar: string | null; owner: boolean; guildId: string; exp: number };

const SESSION_TTL_SECONDS = 24 * 60 * 60;

function oauthEnabled(): boolean {
    return Boolean(
        config.dashboardOAuthClientId &&
            config.dashboardOAuthClientSecret &&
            config.dashboardOAuthRedirectUri &&
            config.dashboardSessionSecret &&
            config.dashboardOAuthGuildId
    );
}

function cookies(req: http.IncomingMessage): Record<string, string> {
    const result: Record<string, string> = {};
    const raw = req.headers.cookie ?? '';
    for (const part of raw.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        const key = part.slice(0, index).trim();
        try {
            result[key] = decodeURIComponent(part.slice(index + 1).trim());
        } catch {
            result[key] = part.slice(index + 1).trim();
        }
    }
    return result;
}

function appendCookie(res: http.ServerResponse, cookie: string): void {
    const current = res.getHeader('set-cookie');
    if (Array.isArray(current)) res.setHeader('set-cookie', [...current, cookie]);
    else if (typeof current === 'string') res.setHeader('set-cookie', [current, cookie]);
    else res.setHeader('set-cookie', cookie);
}

function setCookie(res: http.ServerResponse, name: string, value: string, maxAge: number): void {
    const secure = config.dashboardOAuthRedirectUri.startsWith('https://') ? '; Secure' : '';
    appendCookie(res, `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function sessionSignature(payload: string): string {
    return createHmac('sha256', config.dashboardSessionSecret).update(payload).digest('base64url');
}

function createSession(user: { id: string; username: string; avatar: string | null }, owner: boolean, guildId: string): string {
    const payload = Buffer.from(
        JSON.stringify({ id: user.id, name: user.username, avatar: user.avatar, owner, guildId, exp: Date.now() + SESSION_TTL_SECONDS * 1000 })
    ).toString('base64url');
    return `${payload}.${sessionSignature(payload)}`;
}

function readSession(req: http.IncomingMessage): DashboardSession | null {
    if (!config.dashboardSessionSecret) return null;
    const raw = cookies(req)['bdj_session'];
    if (!raw) return null;
    const [payload, signature] = raw.split('.');
    if (!payload || !signature) return null;
    const expected = sessionSignature(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as DashboardSession;
        if (!session.id || !session.exp || session.exp < Date.now()) return null;
        session.owner = Boolean(session.owner);
        // Cookies issued before the guild binding existed are still scoped to
        // the configured dashboard guild, never to arbitrary guild ids.
        session.guildId = session.guildId || config.dashboardOAuthGuildId;
        return session;
    } catch {
        return null;
    }
}

function viewer(req: http.IncomingMessage): { name: string; owner: boolean; admin: boolean } {
    const session = readSession(req);
    if (session) return { name: session.name, owner: session.owner, admin: true };
    return { name: 'Local admin', owner: true, admin: true };
}

function guildAllowed(req: http.IncomingMessage, guildId: string): boolean {
    if (!oauthEnabled()) return true;
    const session = readSession(req);
    return Boolean(session && guildId && session.guildId === guildId);
}

function authorized(req: http.IncomingMessage): boolean {
    if (oauthEnabled()) return Boolean(readSession(req));
    if (!config.dashboardToken) return true;
    const header = req.headers['x-dashboard-token'];
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    return header === config.dashboardToken || bearer === config.dashboardToken;
}

function guildDenied(res: http.ServerResponse): void {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Guild not permitted for this dashboard session' }));
}

function loginPage(): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BootstrapDJ — Login</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090d14;color:#e8eef7;font:15px system-ui,sans-serif}.box{width:min(360px,90vw);background:#121925;border:1px solid #263346;border-radius:16px;padding:28px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.4)}h1{font-size:20px;margin:0 0 8px}p{color:#8fa0b8;font-size:13px;line-height:1.5;margin:0 0 22px}a{display:block;background:#5865f2;color:#fff;text-decoration:none;padding:12px;border-radius:9px;font-weight:700}a:hover{background:#4752c4}.small{color:#6b7c93;font-size:11px;margin-top:18px}</style></head><body><div class="box"><h1>BootstrapDJ Dashboard</h1><p>Sign in with Discord. Only server admins can access this dashboard.</p><a href="/auth/discord">Continue with Discord</a><div class="small">Server administrators only</div></div></body></html>`;
}

function oauthRedirectUrl(state: string): string {
    const params = new URLSearchParams({
        client_id: config.dashboardOAuthClientId,
        redirect_uri: config.dashboardOAuthRedirectUri,
        response_type: 'code',
        scope: 'identify guilds',
        state,
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function handleOAuthCallback(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const expected = cookies(req)['bdj_oauth_state'] ?? '';
    setCookie(res, 'bdj_oauth_state', '', 0);
    if (!code || !state || !expected || state !== expected) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('invalid oauth state');
        return;
    }
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.dashboardOAuthClientId,
            client_secret: config.dashboardOAuthClientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.dashboardOAuthRedirectUri,
        }),
    });
    if (!tokenResponse.ok) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('discord token exchange failed');
        return;
    }
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('discord token missing');
        return;
    }
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [userResponse, guildsResponse] = await Promise.all([
        fetch('https://discord.com/api/users/@me', { headers }),
        fetch('https://discord.com/api/users/@me/guilds', { headers }),
    ]);
    if (!userResponse.ok || !guildsResponse.ok) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('discord profile lookup failed');
        return;
    }
    const user = (await userResponse.json()) as { id: string; username: string; avatar: string | null };
    const guilds = (await guildsResponse.json()) as Array<{ id: string; owner?: boolean; permissions?: string }>;
    const guild = guilds.find(entry => entry.id === config.dashboardOAuthGuildId);
    const permissions = Number(guild?.permissions ?? 0);
    if (!guild || (!guild.owner && (permissions & 0x20) !== 0x20)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('server administrator permission required');
        return;
    }
    setCookie(res, 'bdj_session', createSession(user, guild.owner === true, config.dashboardOAuthGuildId), SESSION_TTL_SECONDS);
    res.writeHead(302, { location: '/' });
    res.end();
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 64_000) {
                reject(new Error('Request too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function bodyText(value: unknown, fallback: string = ''): string {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : fallback;
}

function state(client: BootstrapClient, guildId: string): Record<string, unknown> {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Unknown guild');
    const player = client.queue.get(guildId);
    const active = new Set((player?.filters ?? []).map(name => name.toLowerCase()));
    return {
        guildId,
        player: player
            ? {
                  title: player.current?.info.title ?? null,
                  author: player.current?.info.author ?? null,
                  duration: player.current?.info.length ?? 0,
                  position: player.player.position,
                  queueLength: player.queue.length,
                  upcoming: player.queue.slice(0, 20).map((track, index) => ({
                      position: index + 1,
                      title: track.info.title,
                      author: track.info.author,
                      duration: track.info.isStream ? 0 : track.info.length,
                  })),
                  volume: player.volume,
                  paused: player.paused,
                  loop: player.loop,
                  autoplay: player.autoplay,
              }
            : null,
        filters: FILTERS.map(filter => ({
            id: filter.id,
            label: filter.label,
            description: filter.description,
            value: filter.value,
            current: player?.filterValues?.[filter.id],
            active: active.has((filter.activeName ?? filter.id).toLowerCase()),
        })),
        settings: DEFAULTS,
    };
}

async function settingsState(client: BootstrapClient, guildId: string): Promise<Record<string, string>> {
    const stored = await client.db.getGuildSettings(guildId);
    const autoplay = await client.db.getAutoplaySetting(guildId).catch(() => null);
    return {
        ...DEFAULTS,
        ...stored,
        autoplaysource: autoplay?.source ?? DEFAULTS.autoplaysource,
        autoplayseeds: autoplay?.seeds ?? DEFAULTS.autoplayseeds,
    };
}

async function updateSetting(
    client: BootstrapClient,
    guildId: string,
    key: string,
    value: string
): Promise<void> {
    if (!isKnownSetting(key)) throw new Error(`Unknown setting: ${key}`);
    if (AUTOPLAY_FIELDS.has(key)) {
        if (key === 'autoplayreset') {
            await client.db.deleteAutoplaySetting(guildId);
            return;
        }
        if (!value && key !== 'autoplayseeds') return;
        const current = await client.db.getAutoplaySetting(guildId).catch(() => null);
        if (key === 'autoplaysource') {
            if (!['chart', 'curated', 'legacy'].includes(value)) throw new Error('Invalid autoplay source');
            await client.db.setAutoplaySetting(guildId, {
                source: value,
                seeds: current?.seeds ?? client.config.autoplaySeeds.join(', '),
            });
            return;
        }
        await client.db.setAutoplaySetting(guildId, { source: 'curated', seeds: value });
        return;
    }
    await client.db.setGuildSetting(guildId, key, value);
}

function filterState(client: BootstrapClient, guildId: string): Record<string, unknown> {
    const player = client.queue.get(guildId);
    if (!player) throw new Error('No active player');
    return { active: player.filters };
}

const FILTER_GROUPS: string[][] = [
    ['nightcore', 'pitch', 'rate', 'speed'],
    ['8d', 'rotation'],
];

function applyFilter(client: BootstrapClient, guildId: string, id: string, enabled: boolean, value?: number): void {
    const player = client.queue.get(guildId);
    if (!player) throw new Error('No active player');
    const def = FILTERS.find(filter => filter.id === id);
    if (!def) throw new Error('Unknown filter');
    if (enabled) {
        const base = value ?? def.value?.fallback ?? 1;
        const applied = def.value
            ? Math.min(def.value.max, Math.max(def.value.min, Number.isFinite(base) ? base : def.value.fallback))
            : base;
        for (const group of FILTER_GROUPS) {
            if (!group.includes(id)) continue;
            for (const siblingId of group) {
                if (siblingId === id) continue;
                const sibling = FILTERS.find(filter => filter.id === siblingId);
                if (!sibling?.activeName) continue;
                player.filters = player.filters.filter(name => name !== sibling.activeName);
                delete player.filterValues[sibling.id];
            }
        }
        def.enable(player, applied);
        if (def.value) player.filterValues[def.id] = applied;
        if (def.activeName && !player.filters.includes(def.activeName)) player.filters.push(def.activeName);
    } else {
        def.disable(player);
        delete player.filterValues[def.id];
        if (def.activeName) player.filters = player.filters.filter(name => name !== def.activeName);
    }
}

async function playerAction(client: BootstrapClient, guildId: string, action: string, value: number): Promise<void> {
    const player = client.queue.get(guildId);
    if (!player) throw new Error('No active player');
    switch (action) {
        case 'toggle':
            player.pause();
            break;
        case 'next':
            await player.skip();
            break;
        case 'previous':
            player.previousTrack();
            break;
        case 'stop':
            player.stop();
            break;
        case 'leave':
            player.destroy();
            break;
        case 'shuffle':
            player.setShuffle();
            await player.persist();
            break;
        case 'loop': {
            const loops: Array<'off' | 'repeat' | 'queue'> = ['off', 'repeat', 'queue'];
            const index = loops.indexOf(player.loop);
            player.setLoop(loops[(index + 1) % loops.length]);
            break;
        }
        case 'volume': {
            if (!Number.isFinite(value) || value < 0 || value > 200) throw new Error('Volume must be 0–200');
            void player.player.setGlobalVolume(value).catch(error => client.logger.warn(`[dashboard] volume failed: ${error}`));
            break;
        }
        case 'jump': {
            if (!Number.isInteger(value) || value < 1 || value > player.queue.length) {
                throw new Error('Invalid queue position');
            }
            await player.skip(value);
            break;
        }
        default:
            throw new Error('Unknown player action');
    }
}

export function startDashboard(client: BootstrapClient): void {
    if (!config.dashboardPort) return;
    const host = config.dashboardHost;
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!loopback && !config.dashboardToken && !oauthEnabled()) {
        client.logger.error('[dashboard] refusing non-loopback bind without DASHBOARD_TOKEN or Discord OAuth');
        return;
    }
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            if (req.method === 'GET' && url.pathname === '/auth/discord' && oauthEnabled()) {
                const state = randomBytes(24).toString('hex');
                setCookie(res, 'bdj_oauth_state', state, 600);
                res.writeHead(302, { location: oauthRedirectUrl(state) });
                res.end();
                return;
            }
            if (req.method === 'GET' && url.pathname === '/auth/callback' && oauthEnabled()) {
                await handleOAuthCallback(req, res, url);
                return;
            }
            if (req.method === 'GET' && url.pathname === '/auth/logout') {
                setCookie(res, 'bdj_session', '', 0);
                res.writeHead(302, { location: '/' });
                res.end();
                return;
            }
            if (!authorized(req)) {
                if (oauthEnabled() && req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
                    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(loginPage());
                    return;
                }
                res.writeHead(401, { 'content-type': 'text/plain' });
                res.end('unauthorized');
                return;
            }
            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                res.end(oauthEnabled() ? HTML.replace('<body>', '<body data-oauth="1">') : HTML);
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/guilds') {
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(
                    JSON.stringify({
                        guilds: [...client.guilds.cache.values()]
                            .filter(guild => !oauthEnabled() || guild.id === config.dashboardOAuthGuildId)
                            .map(guild => ({
                                id: guild.id,
                                name: guild.name,
                            })),
                        viewer: viewer(req),
                    })
                );
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/player-state') {
                const guildId = url.searchParams.get('guildId') ?? '';
                if (!guildAllowed(req, guildId)) return guildDenied(res);
                const data = state(client, guildId);
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ player: data.player }));
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/state') {
                const guildId = url.searchParams.get('guildId') ?? '';
                if (!guildAllowed(req, guildId)) return guildDenied(res);
                const data = state(client, guildId);
                data.settings = await settingsState(client, guildId);
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify(data));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/settings') {
                const body = await readBody(req);
                const guildId = bodyText(body.guildId);
                if (!guildAllowed(req, guildId)) return guildDenied(res);
                if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
                    for (const [key, value] of Object.entries(body.settings as Record<string, unknown>)) {
                        await updateSetting(client, guildId, key, bodyText(value));
                    }
                } else {
                    const key = bodyText(body.key);
                    const value = bodyText(body.value);
                    await updateSetting(client, guildId, key, value);
                }
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ok: true, settings: await settingsState(client, guildId) }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/filter') {
                const body = await readBody(req);
                const guildId = bodyText(body.guildId);
                if (!guildAllowed(req, guildId)) return guildDenied(res);
                const filter = bodyText(body.filter);
                const enabled = Boolean(body.enabled);
                const value = body.value === undefined ? undefined : Number(body.value);
                applyFilter(client, guildId, filter, enabled, value);
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ok: true, filters: filterState(client, guildId) }));
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/stats') {
                const guildId = url.searchParams.get('guildId') ?? '';
                if (!guildAllowed(req, guildId)) return guildDenied(res);
                const requestedDays = Number(url.searchParams.get('days') ?? 7);
                const days = Number.isFinite(requestedDays) ? Math.min(90, Math.max(1, requestedDays)) : 7;
                const data = await client.db.getStats(guildId, days);
                const iconFor = (source: string): string | null => client.config.icons[source.toLowerCase()] ?? null;
                const tracks = data.topTracks as Array<{ source: string; icon?: string | null }>;
                for (const track of tracks) track.icon = iconFor(track.source);
                const sourceList = data.sources as Array<{ source: string; icon?: string | null }>;
                for (const source of sourceList) source.icon = iconFor(source.source);
                const listeners = data.topListeners as Array<{ userId: string; seconds: number; deafSeconds: number }>;
                for (const listener of listeners) {
                    const user = client.users.cache.get(listener.userId);
                    Object.assign(listener, {
                        name: user?.username ?? 'Unknown user',
                        avatar: user?.displayAvatarURL() ?? null,
                    });
                }
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify(data));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/stats/clear') {
                const clearBody = await readBody(req);
                const clearGuildId = bodyText(clearBody.guildId);
                if (!guildAllowed(req, clearGuildId)) return guildDenied(res);
                if (!viewer(req).owner) {
                    res.writeHead(403, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Only the server owner can clear statistics' }));
                    return;
                }
                const removed = await client.db.clearStats(clearGuildId);
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ok: true, removed }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/player') {
                const body = await readBody(req);
                const guildId = bodyText(body.guildId);
                if (!guildAllowed(req, guildId)) return guildDenied(res);
                const action = bodyText(body.action);
                const value = Number(body.value ?? 0);
                await playerAction(client, guildId, action, value);
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ok: true, player: state(client, guildId).player }));
                return;
            }
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('not found');
        } catch (error) {
            res.writeHead(400, { 'content-type': 'text/plain' });
            res.end(error instanceof Error ? error.message : 'dashboard error');
        }
    });
    server.on('error', error => {
        client.logger.error(`[dashboard] server error: ${error}`);
    });
    server.listen(config.dashboardPort, host, () => {
        client.logger.info(`[dashboard] http://${host}:${config.dashboardPort}`);
    });
}
