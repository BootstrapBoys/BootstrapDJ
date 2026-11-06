import type Dispatcher from '../structures/Dispatcher.js';
import type { BootstrapClient } from '../structures/index.js';
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
.now{font-size:18px;font-weight:650;margin:10px 0 2px}.now-meta{color:var(--muted);font-size:13px}
.progress{height:6px;background:#2b3340;border-radius:99px;overflow:hidden;margin:12px 0}.progress>div{height:100%;width:0;background:var(--accent);transition:width .5s}
.controls{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:12px 0 16px}
.ctrl{background:var(--panel2);border:1px solid #394556;color:var(--text);border-radius:9px;min-width:38px;padding:8px 10px;font-size:15px}.ctrl:hover{border-color:var(--accent)}.ctrl.on{border-color:var(--accent);color:var(--accent)}
.volume{display:flex;gap:7px;align-items:center;color:var(--muted);font-size:12px;margin-left:auto}.volume input{width:110px;accent-color:var(--accent)}
.queue-block{border-top:1px solid #2f3948;padding-top:12px}.queue-head{display:flex;justify-content:space-between;align-items:baseline}.queue-head h3{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:0 0 8px}
.queue-list{display:grid;gap:5px;max-height:260px;overflow:auto}.queue-item{display:flex;gap:10px;align-items:baseline;padding:7px 9px;background:var(--panel2);border-radius:7px;font-size:13px}.queue-item .qpos{color:var(--muted);width:20px;flex:none}.queue-item .qtitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.queue-item .qmeta{color:var(--muted);font-size:12px;flex:none}
.settings{display:grid;gap:18px}
.settings-group{border-top:1px solid #2f3948;padding-top:13px}.settings-group:first-child{border-top:0;padding-top:0}
.settings-group h3{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--accent);margin:0 0 9px}
.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.setting{display:grid;gap:5px}.setting input,.setting select{width:100%}
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
</style>
</head>
<body>
<header><h1>BootstrapDJ dashboard</h1><div style="display:flex;gap:8px;align-items:center"><span id="status" class="small">loading…</span><select id="guild"></select><button id="settings-btn" class="gear" title="Settings" aria-label="Open settings">⚙</button></div></header>
<main>
<section class="panel">
<div class="player-top"><h2>Player</h2><span id="player-state" class="small"></span></div>
<div id="now-title" class="now">Nothing playing</div>
<div id="now-meta" class="now-meta"></div>
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
<div id="toast"></div>
<script>
const state={guildId:null,data:null};
const $=s=>document.querySelector(s);
function token(){return localStorage.getItem('bootstrapdj-dashboard-token')||''}
function headers(json){const h={'x-dashboard-token':token()};if(json)h['content-type']='application/json';return h}
function toast(text,isError){const el=$('#toast');el.textContent=text;el.className='show '+(isError?'error':'ok');setTimeout(()=>el.className='',2500)}
async function api(path,options){const res=await fetch(path,{...options,headers:{...headers(Boolean(options&&options.body)),...(options&&options.headers)}});if(res.status===401){const t=prompt('Dashboard token');if(t){localStorage.setItem('bootstrapdj-dashboard-token',t);return api(path,options)}}if(!res.ok)throw new Error((await res.text())||res.statusText);return res.json()}
async function boot(){const g=await api('/api/guilds');const sel=$('#guild');sel.innerHTML='';for(const guild of g.guilds){const o=document.createElement('option');o.value=guild.id;o.textContent=guild.name;sel.appendChild(o)}if(!g.guilds.length){$('#status').textContent='No guilds';return}state.guildId=g.guilds[0].id;sel.value=state.guildId;sel.onchange=()=>{state.guildId=sel.value;load()};await load()}
async function load(){try{state.data=await api('/api/state?guildId='+encodeURIComponent(state.guildId));render();$('#status').textContent='Connected'}catch(e){$('#status').textContent='Error';toast(e.message,true)}}
const GROUPS=[
{title:'Playback',keys:['defaultvolume','defaultautoplay','defaultrepeat','defaultshuffle','searchtype','maxqueue','maxuserqueue','voteskip','voteskippercent','autocorrect','volumeautomatic']},
{title:'Autoplay',keys:['autoplaysource','autoplayseeds']},
{title:'Announcements',keys:['announce','announcechannel','deleteafter']},
{title:'Limits',keys:['maxtracklength','mintracklength','maxusertracks','maxusertrackslength','maxplaylisttracks','maxplaylistlength']},
{title:'Access and channels',keys:['locked','commandchannel','voicechannel','disabledcommands']}
];
const LABELS={defaultvolume:'Default volume',defaultautoplay:'Default autoplay',defaultrepeat:'Default repeat',defaultshuffle:'Default shuffle',searchtype:'Search engine',maxqueue:'Max queue size',maxuserqueue:'Max per-user queue',voteskip:'Vote skip enabled',voteskippercent:'Vote skip percent',autocorrect:'Autocorrect suggestions',volumeautomatic:'Automatic volume',autoplaysource:'Source',autoplayseeds:'Curated seeds',announce:'Text announcements',announcechannel:'Announcement channel ID',deleteafter:'Reply delete after (s)',maxtracklength:'Max track length (s)',mintracklength:'Min track length (s)',maxusertracks:'Max user tracks',maxusertrackslength:'Max user track length (s)',maxplaylisttracks:'Max playlist tracks',maxplaylistlength:'Max playlist length (s)',locked:'Session locked',commandchannel:'Command channel ID',voicechannel:'Required voice channel ID',disabledcommands:'Disabled commands'};
const BOOLS=new Set(['defaultautoplay','defaultshuffle','voteskip','announce','autocorrect','volumeautomatic','locked']);
const LONG=new Set(['autoplayseeds','disabledcommands','announcechannel','commandchannel','voicechannel']);
function field(key,value){const box=document.createElement('label');box.className='setting'+(LONG.has(key)?' wide':'');const title=document.createElement('span');title.className='small';title.textContent=LABELS[key]||key;box.appendChild(title);let input;if(key==='autoplaysource'){input=document.createElement('select');for(const v of ['chart','curated','legacy']){const o=document.createElement('option');o.value=v;o.textContent=v;input.appendChild(o)}input.value=value||'chart'}else if(BOOLS.has(key)){input=document.createElement('select');for(const v of ['true','false']){const o=document.createElement('option');o.value=v;o.textContent=v;input.appendChild(o)}input.value=value==='true'?'true':'false'}else{input=document.createElement('input');input.value=value;input.type=['defaultvolume','maxqueue','maxuserqueue','voteskippercent','deleteafter','maxtracklength','mintracklength','maxusertracks','maxusertrackslength','maxplaylisttracks','maxplaylistlength'].includes(key)?'number':'text'}input.dataset.key=key;box.appendChild(input);return box}
function renderPlayer(d){const p=d.player;const title=$('#now-title'),meta=$('#now-meta'),bar=$('#progress-bar'),stateEl=$('#player-state'),list=$('#queue-list'),count=$('#queue-count');if(!p){title.textContent='Nothing playing';meta.textContent='';bar.style.width='0';stateEl.textContent='idle';list.innerHTML='<div class="small">Nothing queued.</div>';count.textContent='';$('#volume').value=100;$('#volume-label').textContent='100%';$('#loop-btn').textContent='Loop: off';return}title.textContent=p.title||'Nothing playing';meta.textContent=(p.author||'')+(p.duration?' · '+formatMs(p.duration):'')+(p.position?' · '+formatMs(p.position):'');bar.style.width=(p.duration?Math.min(100,Math.round((p.position/p.duration)*100)):0)+'%';stateEl.textContent=(p.paused?'paused':'playing')+(p.autoplay?' · autoplay':'');$('#volume').value=p.volume??100;$('#volume-label').textContent=($('#volume').value)+'%';const loop=$('#loop-btn');loop.textContent='Loop: '+p.loop;loop.classList.toggle('on',p.loop!=='off');count.textContent=p.queueLength+' queued';list.innerHTML='';if(!p.upcoming||!p.upcoming.length){list.innerHTML='<div class="small">Nothing queued.</div>';return}for(const t of p.upcoming){const row=document.createElement('div');row.className='queue-item';const pos=document.createElement('span');pos.className='qpos';pos.textContent=t.position;const name=document.createElement('span');name.className='qtitle';name.textContent=t.title;const meta2=document.createElement('span');meta2.className='qmeta';meta2.textContent=(t.author||'')+(t.duration?' · '+formatMs(t.duration):'');row.append(pos,name,meta2);list.appendChild(row)}}
function formatMs(ms){const s=Math.max(0,Math.floor(ms/1000));const m=Math.floor(s/60);const h=Math.floor(m/60);return h?h+':'+String(m%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0'):m+':'+String(s%60).padStart(2,'0')}
function render(){const d=state.data;renderPlayer(d);
 const wrap=$('#filters');wrap.innerHTML='';for(const f of d.filters){const row=document.createElement('div');row.className='filter';const active=f.active;const label=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.checked=active;cb.onchange=()=>toggleFilter(f.id,cb.checked,row);label.appendChild(cb);const span=document.createElement('span');span.textContent=f.label;label.appendChild(span);row.appendChild(label);if(f.value){const input=document.createElement('input');input.type='number';input.className='value';input.min=f.value.min;input.max=f.value.max;input.step=f.value.step;input.value=f.current??f.value.fallback;input.onchange=()=>{if(cb.checked)toggleFilter(f.id,true,row,input.value)};row.appendChild(input)}wrap.appendChild(row)}
 const s=$('#settings');s.innerHTML='';const seen=new Set();for(const group of GROUPS){const section=document.createElement('section');section.className='settings-group';const heading=document.createElement('h3');heading.textContent=group.title;section.appendChild(heading);const grid=document.createElement('div');grid.className='settings-grid';for(const key of group.keys){if(!(key in d.settings))continue;seen.add(key);grid.appendChild(field(key,d.settings[key]))}section.appendChild(grid);if(group.title==='Autoplay'){const reset=document.createElement('button');reset.className='autoplay-reset';reset.textContent='Reset autoplay override';reset.onclick=async()=>{try{await api('/api/settings',{method:'POST',body:JSON.stringify({guildId:state.guildId,key:'autoplayreset',value:'true'})});await load();toast('Autoplay override reset')}catch(e){toast(e.message,true)}};section.appendChild(reset)}s.appendChild(section)}const rest=Object.keys(d.settings).filter(key=>!seen.has(key));if(rest.length){const section=document.createElement('section');section.className='settings-group';const heading=document.createElement('h3');heading.textContent='Other';section.appendChild(heading);const grid=document.createElement('div');grid.className='settings-grid';for(const key of rest)grid.appendChild(field(key,d.settings[key]));section.appendChild(grid);s.appendChild(section)}}
function escapeHtml(v){const d=document.createElement('div');d.textContent=v;return d.innerHTML}
async function toggleFilter(id,enabled,row,value){try{await api('/api/filter',{method:'POST',body:JSON.stringify({guildId:state.guildId,filter:id,enabled,value:value===undefined?undefined:Number(value)})});await load();toast((enabled?'Enabled ':'Disabled ')+id)}catch(e){toast(e.message,true);if(row)row.classList.add('error')}}
const modal=$('#settings-modal');
function openSettings(){modal.classList.add('open')}
function closeSettings(){modal.classList.remove('open')}
$('#settings-btn').onclick=openSettings;
$('#settings-close').onclick=closeSettings;
$('#settings-cancel').onclick=closeSettings;
modal.addEventListener('click',e=>{if(e.target===modal)closeSettings()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSettings()});
async function playerAction(action,value){try{await api('/api/player',{method:'POST',body:JSON.stringify({guildId:state.guildId,action,value})});await load()}catch(e){toast(e.message,true)}}
document.querySelectorAll('[data-player]').forEach(button=>button.onclick=()=>playerAction(button.dataset.player));
$('#volume').onchange=()=>{const value=Number($('#volume').value);$('#volume-label').textContent=value+'%';playerAction('volume',value)};
$('#volume').oninput=()=>{$('#volume-label').textContent=$('#volume').value+'%'};
$('#save').onclick=async()=>{const values={};for(const el of document.querySelectorAll('#settings input, #settings select'))values[el.dataset.key]=el.value;try{for(const [key,value] of Object.entries(values))await api('/api/settings',{method:'POST',body:JSON.stringify({guildId:state.guildId,key,value})});await load();toast('Settings saved')}catch(e){toast(e.message,true)}};
boot().catch(e=>{$('#status').textContent='Error';toast(e.message,true)});
</script>
</body></html>`;

function authorized(req: http.IncomingMessage, url: URL): boolean {
    if (!config.dashboardToken) return true;
    const header = req.headers['x-dashboard-token'];
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    return header === config.dashboardToken || bearer === config.dashboardToken || url.searchParams.get('token') === config.dashboardToken;
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
            current: undefined,
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
        if (!value) return;
        if (key === 'autoplayreset') {
            await client.db.deleteAutoplaySetting(guildId);
            return;
        }
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

function applyFilter(client: BootstrapClient, guildId: string, id: string, enabled: boolean, value?: number): void {
    const player = client.queue.get(guildId);
    if (!player) throw new Error('No active player');
    const def = FILTERS.find(filter => filter.id === id);
    if (!def) throw new Error('Unknown filter');
    if (enabled) {
        def.enable(player, value ?? def.value?.fallback ?? 1);
        if (def.activeName && !player.filters.includes(def.activeName)) player.filters.push(def.activeName);
    } else {
        def.disable(player);
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
            player.player.setGlobalVolume(value);
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
    if (!loopback && !config.dashboardToken) {
        client.logger.error('[dashboard] refusing non-loopback bind without DASHBOARD_TOKEN');
        return;
    }
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        try {
            if (!authorized(req, url)) {
                res.writeHead(401, { 'content-type': 'text/plain' });
                res.end('unauthorized');
                return;
            }
            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end(HTML);
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/guilds') {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(
                    JSON.stringify({
                        guilds: [...client.guilds.cache.values()].map(guild => ({
                            id: guild.id,
                            name: guild.name,
                        })),
                    })
                );
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/state') {
                const guildId = url.searchParams.get('guildId') ?? '';
                const data = state(client, guildId);
                data.settings = await settingsState(client, guildId);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(data));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/settings') {
                const body = await readBody(req);
                const guildId = bodyText(body.guildId);
                const key = bodyText(body.key);
                const value = bodyText(body.value);
                await updateSetting(client, guildId, key, value);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, settings: await settingsState(client, guildId) }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/filter') {
                const body = await readBody(req);
                const guildId = bodyText(body.guildId);
                const filter = bodyText(body.filter);
                const enabled = Boolean(body.enabled);
                const value = body.value === undefined ? undefined : Number(body.value);
                applyFilter(client, guildId, filter, enabled, value);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, filters: filterState(client, guildId) }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/player') {
                const body = await readBody(req);
                const guildId = bodyText(body.guildId);
                const action = bodyText(body.action);
                const value = Number(body.value ?? 0);
                await playerAction(client, guildId, action, value);
                res.writeHead(200, { 'content-type': 'application/json' });
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
    server.listen(config.dashboardPort, host, () => {
        client.logger.info(`[dashboard] http://${host}:${config.dashboardPort}`);
    });
}
