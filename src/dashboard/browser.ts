/**
 * Browser half of the dashboard. The source is shipped inside the HTML page
 * (`page.ts`) because the dashboard is a single self-contained document: no
 * bundler, no external assets, no build step for the UI.
 *
 * Keep this file free of template literals and backticks; it is embedded in a
 * `String.raw` template. Everything here uses concatenation so the emitted text
 * matches this source exactly.
 */
export const BROWSER_SCRIPT = String.raw`
(() => {
    'use strict';

    const TOKEN_KEY = 'bootstrapdj-dashboard-token';
    const POLL_MS = 1000;
    const VOLUME_DETENT = 5;
    const VOLUME_HOLD_MS = 1200;
    const TOAST_MS = 2500;

    const state = {
        guildId: null,
        csrf: '',
        guilds: [],
        data: null,
        access: { member: false, owner: false, admin: false, controls: false, settings: false },
        queueSignature: null,
    };

    const find = selector => document.querySelector(selector);

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // ---- HTTP ------------------------------------------------------------

    function storedToken() {
        return localStorage.getItem(TOKEN_KEY) || '';
    }

    function requestHeaders(body, method) {
        const headers = { 'x-dashboard-token': storedToken() };
        if (body) headers['content-type'] = 'application/json';
        if (method === 'POST' && state.csrf) headers['x-dashboard-csrf'] = state.csrf;
        return headers;
    }

    async function request(path, options) {
        const settings = options || {};
        const method = settings.method || 'GET';
        const response = await fetch(path, {
            ...settings,
            headers: {
                ...requestHeaders(Boolean(settings.body), method),
                ...(settings.headers || {}),
            },
        });
        if (response.status === 401) {
            if (document.body.dataset.oauth === '1') {
                window.location.href = '/auth/discord';
                throw new Error('Login required');
            }
            const supplied = window.prompt('Dashboard token');
            if (supplied) {
                localStorage.setItem(TOKEN_KEY, supplied);
                return request(path, options);
            }
        }
        if (!response.ok) throw new Error((await response.text()) || response.statusText);
        return response.json();
    }

    function postJson(path, payload) {
        return request(path, { method: 'POST', body: JSON.stringify(payload) });
    }

    // ---- feedback --------------------------------------------------------

    let toastTimer = 0;

    function notify(message, isError) {
        const box = find('#toast');
        box.textContent = message;
        box.className = 'show ' + (isError ? 'error' : 'ok');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            box.className = '';
        }, TOAST_MS);
    }

    // ---- formatting ------------------------------------------------------

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function formatClock(milliseconds) {
        const total = Math.max(0, Math.floor(milliseconds / 1000));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor(total / 60) % 60;
        const seconds = total % 60;
        return hours ? hours + ':' + pad(minutes) + ':' + pad(seconds) : minutes + ':' + pad(seconds);
    }

    function formatDuration(seconds) {
        const total = Math.max(0, Math.round(seconds));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const remainder = total % 60;
        return hours ? hours + ':' + pad(minutes) + ':' + pad(remainder) : minutes + ':' + pad(remainder);
    }

    function formatHours(seconds) {
        const total = Math.max(0, Math.round(seconds / 60));
        const hours = Math.floor(total / 60);
        const minutes = total % 60;
        return hours ? hours + 'h ' + minutes + 'm' : minutes + 'm';
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, character => {
            const replacements = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            };
            return replacements[character];
        });
    }

    function safeUrl(value) {
        const text = String(value || '');
        return /^https?:\/\//i.test(text) ? text : '';
    }

    // ---- settings catalogue ---------------------------------------------

    const GROUPS = [
        {
            title: 'Playback',
            keys: [
                'defaultvolume',
                'defaultautoplay',
                'defaultrepeat',
                'defaultshuffle',
                'searchtype',
                'maxqueue',
                'maxuserqueue',
                'voteskip',
                'voteskippercent',
                'autocorrect',
                'volumeautomatic',
                'loudnesstarget',
            ],
        },
        { title: 'Autoplay', keys: ['autoplaysource', 'autoplayseeds'] },
        { title: 'Responses', keys: ['ephemeral', 'announce', 'announcechannel', 'deleteafter'] },
        {
            title: 'Limits',
            keys: [
                'maxtracklength',
                'mintracklength',
                'maxusertracks',
                'maxusertrackslength',
                'maxplaylisttracks',
                'maxplaylistlength',
                'timeoutlisteners',
                'timeoutpause',
                'timeoutplaying',
                'timeoutconfirmation',
            ],
        },
        {
            title: 'Access and channels',
            keys: ['locked', 'allowthreads', 'commandchannel', 'voicechannel', 'disabledcommands'],
        },
    ];

    const LABELS = {
        defaultvolume: 'Default volume',
        defaultautoplay: 'Default autoplay',
        defaultrepeat: 'Default repeat',
        defaultshuffle: 'Default shuffle',
        searchtype: 'Search engine',
        maxqueue: 'Max queue size',
        maxuserqueue: 'Max per-user queue',
        voteskip: 'Vote skip enabled',
        voteskippercent: 'Vote skip percent',
        autocorrect: 'Autocorrect suggestions',
        volumeautomatic: 'Automatic volume',
        loudnesstarget: 'Target loudness (LUFS)',
        autoplaysource: 'Source',
        autoplayseeds: 'Curated seeds',
        announce: 'Text announcements',
        announcechannel: 'Announcement channel ID',
        ephemeral: 'Ephemeral slash replies',
        deleteafter: 'Reply delete after (s)',
        maxtracklength: 'Max track length (s)',
        mintracklength: 'Min track length (s)',
        maxusertracks: 'Max user tracks',
        maxusertrackslength: 'Max user track length (s)',
        maxplaylisttracks: 'Max playlist tracks',
        maxplaylistlength: 'Max playlist length (s)',
        locked: 'Session locked',
        allowthreads: 'Commands in threads',
        timeoutlisteners: 'Listener timeout (s)',
        timeoutpause: 'Pause timeout (s)',
        timeoutplaying: 'Idle playback timeout (s)',
        timeoutconfirmation: 'Confirmation prompt (s)',
        commandchannel: 'Command channel ID',
        voicechannel: 'Required voice channel ID',
        disabledcommands: 'Disabled commands',
    };

    const DESCRIPTIONS = {
        defaultvolume: 'Volume applied to new tracks; adaptive loudness uses it as the reference gain.',
        defaultautoplay: 'Start autoplay as soon as the queue runs out.',
        defaultrepeat: 'Loop mode for a new session: off, current track, or whole queue.',
        defaultshuffle: 'Shuffle the queue when the session starts.',
        searchtype:
            'Lavalink search prefix used by slash commands, for example dzsearch, ytsearch, ytmsearch, or scsearch. Prefix commands use PREFIX_SEARCH_ENGINE.',
        maxqueue: 'Upper bound on tracks waiting in the queue.',
        maxuserqueue: 'Queue slots reserved for each member.',
        voteskip: 'Let members start a vote to skip the current track.',
        voteskippercent: 'Share of listeners that must agree before a vote-skip passes.',
        autocorrect: 'Run the closest command when a prefix command is mistyped.',
        volumeautomatic: 'Measure track loudness and steer volume toward the target LUFS.',
        loudnesstarget: 'Target integrated loudness in LUFS; -16 suits most music.',
        autoplaysource: 'Where autoplay starts: Deezer chart, curated seeds, or the legacy seed value.',
        autoplayseeds: 'Comma-separated search phrases used by the curated autoplay source.',
        announce: 'Post a text message when a track starts.',
        ephemeral:
            'Make slash replies private. Disable for normal public replies; prefix replies are always public.',
        announcechannel: 'Text channel ID for the extra announcement. Leave blank to skip it.',
        deleteafter: 'Seconds before replies are removed. 0 keeps them.',
        maxtracklength: 'Reject tracks longer than this many seconds. 0 turns the check off.',
        mintracklength: 'Reject tracks shorter than this many seconds. 0 turns the check off.',
        maxusertracks: 'Most tracks one member may queue. 0 turns the check off.',
        maxusertrackslength: 'Longest total duration one member may queue, in seconds. 0 turns it off.',
        maxplaylisttracks: 'Most tracks accepted from a single playlist. 0 turns the check off.',
        maxplaylistlength: 'Longest total duration accepted from a playlist, in seconds. 0 turns it off.',
        timeoutlisteners: 'Disconnect after this many seconds without listeners. 0 disables.',
        timeoutpause: 'Disconnect after this many seconds paused. 0 disables.',
        timeoutplaying: 'Disconnect after this many seconds with nothing queued. 0 disables.',
        timeoutconfirmation: 'Ask “Still listening?” after this many seconds. 0 disables.',
        locked: 'Only server managers may change settings or run commands while locked.',
        allowthreads: 'Permit commands inside threads.',
        commandchannel: 'Only accept commands in this text channel ID. Blank accepts every channel.',
        voicechannel: 'Require callers to sit in this voice channel ID. Blank removes the requirement.',
        disabledcommands: 'Comma-separated command names disabled in this server.',
    };

    const BOOLEAN_KEYS = new Set([
        'defaultautoplay',
        'defaultshuffle',
        'voteskip',
        'announce',
        'ephemeral',
        'autocorrect',
        'volumeautomatic',
        'locked',
        'allowthreads',
    ]);

    const WIDE_KEYS = new Set([
        'autoplayseeds',
        'disabledcommands',
        'announcechannel',
        'commandchannel',
        'voicechannel',
    ]);

    const NUMERIC_KEYS = new Set([
        'defaultvolume',
        'maxqueue',
        'maxuserqueue',
        'voteskippercent',
        'deleteafter',
        'maxtracklength',
        'mintracklength',
        'maxusertracks',
        'maxusertrackslength',
        'maxplaylisttracks',
        'maxplaylistlength',
        'loudnesstarget',
        'timeoutlisteners',
        'timeoutpause',
        'timeoutplaying',
        'timeoutconfirmation',
    ]);

    function option(value, label) {
        const node = element('option', '', label);
        node.value = value;
        return node;
    }

    function buildSettingField(key, value) {
        const box = element('label', 'setting' + (WIDE_KEYS.has(key) ? ' wide' : ''));
        const heading = element('span', 'setting-label small');
        heading.appendChild(element('span', '', LABELS[key] || key));
        if (DESCRIPTIONS[key]) {
            const help = element('span', 'help', '?');
            help.tabIndex = 0;
            help.setAttribute('role', 'note');
            help.setAttribute('aria-label', DESCRIPTIONS[key]);
            help.dataset.tip = DESCRIPTIONS[key];
            heading.appendChild(help);
        }
        box.appendChild(heading);

        let input;
        if (key === 'autoplaysource') {
            input = element('select');
            for (const source of ['chart', 'curated', 'legacy']) input.appendChild(option(source, source));
            input.value = value || 'chart';
        } else if (BOOLEAN_KEYS.has(key)) {
            input = element('select');
            for (const flag of ['true', 'false']) input.appendChild(option(flag, flag));
            input.value = value === 'true' ? 'true' : 'false';
        } else {
            input = element('input');
            input.value = value;
            input.type = NUMERIC_KEYS.has(key) ? 'number' : 'text';
        }
        input.dataset.key = key;
        box.appendChild(input);
        return box;
    }

    function renderSettings(settings) {
        const container = find('#settings');
        container.textContent = '';
        const rendered = new Set();

        for (const group of GROUPS) {
            const section = element('section', 'settings-group');
            section.appendChild(element('h3', '', group.title));
            const grid = element('div', 'settings-grid');
            for (const key of group.keys) {
                if (!(key in settings)) continue;
                rendered.add(key);
                grid.appendChild(buildSettingField(key, settings[key]));
            }
            section.appendChild(grid);
            if (group.title === 'Autoplay') {
                const reset = element('button', 'autoplay-reset', 'Reset autoplay override');
                reset.onclick = async () => {
                    try {
                        await postJson('/api/settings', {
                            guildId: state.guildId,
                            key: 'autoplayreset',
                            value: 'true',
                        });
                        await loadState();
                        notify('Autoplay override reset');
                    } catch (error) {
                        notify(error.message, true);
                    }
                };
                section.appendChild(reset);
            }
            container.appendChild(section);
        }

        const leftovers = Object.keys(settings).filter(key => !rendered.has(key));
        if (leftovers.length) {
            const section = element('section', 'settings-group');
            section.appendChild(element('h3', '', 'Other'));
            const grid = element('div', 'settings-grid');
            for (const key of leftovers) grid.appendChild(buildSettingField(key, settings[key]));
            section.appendChild(grid);
            container.appendChild(section);
        }
    }

    // ---- filters ---------------------------------------------------------

    function renderFilters(filters) {
        const container = find('#filters');
        container.textContent = '';
        for (const filter of filters) {
            const row = element('div', 'filter');
            const label = element('label');
            const checkbox = element('input');
            checkbox.type = 'checkbox';
            checkbox.checked = filter.active;
            checkbox.onchange = () => toggleFilter(filter.id, checkbox.checked, row);
            label.appendChild(checkbox);
            label.appendChild(element('span', '', filter.label));
            row.appendChild(label);

            if (filter.value) {
                const field = element('input', 'value');
                field.type = 'number';
                field.min = filter.value.min;
                field.max = filter.value.max;
                field.step = filter.value.step;
                field.value = filter.current === null || filter.current === undefined ? filter.value.fallback : filter.current;
                field.onchange = () => {
                    if (checkbox.checked) toggleFilter(filter.id, true, row, field.value);
                };
                row.appendChild(field);
            }
            container.appendChild(row);
        }
    }

    async function toggleFilter(id, enabled, row, value) {
        if (!state.access.settings) {
            notify('Manager access required', true);
            return;
        }
        try {
            await postJson('/api/filter', {
                guildId: state.guildId,
                filter: id,
                enabled,
                value: value === undefined ? undefined : Number(value),
            });
            await loadState();
            notify((enabled ? 'Enabled ' : 'Disabled ') + id);
        } catch (error) {
            notify(error.message, true);
            if (row) row.classList.add('error');
        }
    }

    // ---- player ----------------------------------------------------------

    let progress = { track: '', serverPosition: 0, position: 0, duration: 0, sampledAt: 0, paused: true };

    const progressWrap = find('#progress-wrap');
    const progressTrack = find('#progress');
    const progressTip = find('#progress-tooltip');

    function projectedPosition() {
        const elapsed = progress.paused ? 0 : Date.now() - progress.sampledAt;
        const raw = progress.position + elapsed;
        return progress.duration > 0 ? Math.min(progress.duration, raw) : raw;
    }

    function pointerRatio(clientX) {
        const rect = progressTrack.getBoundingClientRect();
        if (!rect.width) return 0;
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    function hideProgressTip() {
        progressTip.classList.remove('show');
    }

    function showProgressTip(clientX) {
        const player = state.data && state.data.player;
        if (!player || progress.duration <= 0) {
            hideProgressTip();
            return;
        }
        const ratio = pointerRatio(clientX);
        progressTip.textContent = formatClock(Math.round(ratio * progress.duration));
        progressTip.style.left = ratio * 100 + '%';
        progressTip.classList.add('show');
    }

    async function seekTo(time) {
        if (!state.access.controls || !state.data || !state.data.player || progress.duration <= 0) return;
        const target = Math.max(0, Math.min(progress.duration, Math.round(time)));
        progress.position = target;
        progress.serverPosition = target;
        progress.sampledAt = Date.now();
        paintProgress();
        try {
            await postJson('/api/player', { guildId: state.guildId, action: 'seek', value: target });
            await loadState();
        } catch (error) {
            notify(error.message, true);
            await loadState().catch(() => {});
        }
    }

    function paintProgress() {
        const player = state.data && state.data.player;
        if (!player) {
            progressWrap.classList.add('disabled');
            progressWrap.tabIndex = -1;
            hideProgressTip();
            return;
        }
        const position = projectedPosition();
        const percent = progress.duration > 0 ? Math.max(0, Math.min(100, (position / progress.duration) * 100)) : 0;
        find('#progress-bar').style.transform = 'scaleX(' + percent / 100 + ')';
        const clock = formatClock(position) + ' / ' + (progress.duration ? formatClock(progress.duration) : 'LIVE');
        find('#now-time').textContent = clock;

        const seekable = progress.duration > 0 && state.access.controls;
        progressWrap.classList.toggle('disabled', !seekable);
        progressWrap.tabIndex = seekable ? 0 : -1;
        progressWrap.setAttribute('aria-valuemax', String(Math.max(0, progress.duration)));
        progressWrap.setAttribute('aria-valuenow', String(Math.round(position)));
        progressWrap.setAttribute('aria-valuetext', clock);
    }

    function resetPlayerPanel() {
        state.queueSignature = null;
        progress = { track: '', serverPosition: 0, position: 0, duration: 0, sampledAt: Date.now(), paused: true };
        find('#now-title').textContent = 'Nothing playing';
        find('#now-meta').textContent = '';
        find('#player-state').textContent = 'idle';
        find('#progress-bar').style.transform = 'scaleX(0)';
        find('#now-time').textContent = '0:00 / 0:00';
        find('#queue-list').textContent = '';
        find('#queue-list').appendChild(element('div', 'small', 'Nothing queued.'));
        find('#queue-count').textContent = '';
        progressWrap.classList.add('disabled');
        progressWrap.tabIndex = -1;
        hideProgressTip();
        renderVolume(100);
        find('#loop-label').textContent = 'off';
        find('#loop-btn').classList.remove('on');
        const toggle = find('#toggle-btn');
        toggle.classList.add('paused');
        toggle.title = 'Resume';
        toggle.setAttribute('aria-label', 'Resume');
    }

    function syncProgress(player) {
        const nextPosition = player.position || 0;
        const nextDuration = player.duration || 0;
        const nextPaused = Boolean(player.paused);
        const trackKey = (player.title || '') + '|' + (player.author || '') + '|' + nextDuration;
        const estimated = progress.paused ? progress.position : progress.position + (Date.now() - progress.sampledAt);
        const trackChanged = !progress.track || progress.track !== trackKey;
        const moved = nextPosition !== progress.serverPosition;
        const rewound = nextPosition < progress.serverPosition - 1500;
        const skippedAhead = nextPosition > progress.serverPosition + 8000;
        const drifted = moved && Math.abs(nextPosition - estimated) > 2000;

        if (trackChanged || nextPaused !== progress.paused || nextDuration !== progress.duration || rewound || skippedAhead || drifted) {
            progress = {
                track: trackKey,
                serverPosition: nextPosition,
                position: nextPaused ? estimated : nextPosition,
                duration: nextDuration,
                sampledAt: Date.now(),
                paused: nextPaused,
            };
        } else {
            progress.serverPosition = nextPosition;
        }
    }

    function queueSignature(player) {
        const rows = (player.upcoming || []).map(track => track.position + ':' + track.title + ':' + (track.author || ''));
        return (player.queueLength || 0) + '|' + rows.join('|');
    }

    function renderQueue(player) {
        const signature = queueSignature(player);
        if (state.queueSignature === signature) return;
        state.queueSignature = signature;

        const list = find('#queue-list');
        list.textContent = '';
        if (!player.upcoming || !player.upcoming.length) {
            list.appendChild(element('div', 'small', 'Nothing queued.'));
            return;
        }
        for (const track of player.upcoming) {
            const row = element('div', 'queue-item');
            row.append(
                element('span', 'qpos', track.position),
                element('span', 'qtitle', track.title),
                element('span', 'qmeta', (track.author || '') + (track.duration ? ' · ' + formatClock(track.duration) : ''))
            );
            if (state.access.controls) {
                row.title = 'Skip to ' + track.title;
                row.tabIndex = 0;
                row.role = 'button';
                row.onclick = () => playerAction('jump', track.position);
                row.onkeydown = event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        playerAction('jump', track.position);
                    }
                };
            }
            list.appendChild(row);
        }
    }

    function renderPlayer(payload) {
        const player = payload.player;
        if (!player) {
            resetPlayerPanel();
            return;
        }
        find('#now-title').textContent = player.title || 'Nothing playing';
        find('#now-meta').textContent = player.author || '';
        syncProgress(player);
        paintProgress();
        find('#player-state').textContent =
            (player.paused ? 'paused' : 'playing') + (player.autoplay ? ' · autoplay' : '');
        renderVolume(player.volume === null || player.volume === undefined ? 100 : player.volume);

        find('#loop-label').textContent = player.loop;
        find('#loop-btn').classList.toggle('on', player.loop !== 'off');

        const toggle = find('#toggle-btn');
        toggle.classList.toggle('paused', Boolean(player.paused));
        toggle.title = player.paused ? 'Resume' : 'Pause';
        toggle.setAttribute('aria-label', player.paused ? 'Resume' : 'Pause');

        find('#queue-count').textContent = player.queueLength + ' queued';
        renderQueue(player);
    }

    function render() {
        const data = state.data;
        renderPlayer(data);
        renderFilters(data.filters);
        renderSettings(data.settings);
    }

    // ---- state loading ---------------------------------------------------

    function applyAccess() {
        const guild = state.guilds.find(entry => entry.id === state.guildId);
        state.access = {
            member: Boolean(guild && guild.member),
            owner: Boolean(guild && guild.owner),
            admin: Boolean(guild && guild.admin),
            controls: Boolean(guild && guild.controls),
            settings: Boolean(guild && guild.settings),
        };
        find('#settings-btn').style.display = state.access.settings ? '' : 'none';
        find('#player-controls').style.display = state.access.controls ? '' : 'none';
        find('#filters-panel').style.display = state.access.settings ? '' : 'none';
        find('#stats-clear').style.display = state.access.owner ? '' : 'none';
    }

    async function loadState() {
        try {
            state.data = await request('/api/state?guildId=' + encodeURIComponent(state.guildId));
            render();
            find('#status').textContent = state.access.controls ? 'Connected' : 'Read-only';
        } catch (error) {
            find('#status').textContent = 'Error';
            notify(error.message, true);
        }
    }

    async function pollPlayer() {
        const guildId = state.guildId;
        if (!guildId || !state.data) return;
        try {
            const payload = await request('/api/player-state?guildId=' + encodeURIComponent(guildId));
            if (state.guildId !== guildId) return;
            state.data.player = payload.player;
            renderPlayer(payload);
        } catch {
            // The next tick retries; a transient 503 should not spam the UI.
        }
    }

    async function boot() {
        const overview = await request('/api/guilds');
        state.csrf = overview.csrf || '';
        state.guilds = overview.guilds || [];

        const oauth = document.body.dataset.oauth === '1';
        find('#logout-btn').style.display = oauth ? '' : 'none';
        find('#personal-btn').style.display = oauth ? '' : 'none';

        const picker = find('#guild');
        picker.textContent = '';
        for (const guild of state.guilds) picker.appendChild(option(guild.id, guild.name));

        if (!state.guilds.length) {
            applyAccess();
            find('#status').textContent = 'No guilds';
            return;
        }
        state.guildId = state.guilds[0].id;
        picker.value = state.guildId;
        picker.onchange = () => {
            state.guildId = picker.value;
            applyAccess();
            void loadState();
        };
        applyAccess();
        await loadState();
    }

    // ---- actions ---------------------------------------------------------

    async function playerAction(action, value) {
        if (!state.access.controls) {
            notify('Read-only dashboard access', true);
            return;
        }
        try {
            await postJson('/api/player', { guildId: state.guildId, action, value });
            await loadState();
        } catch (error) {
            notify(error.message, true);
        }
    }

    // ---- volume ----------------------------------------------------------

    const volumeInput = find('#volume');
    const volumeLabel = find('#volume-label');
    let volumeDragging = false;
    let volumeHoldUntil = 0;

    function detent(value) {
        return Math.round(value / VOLUME_DETENT) * VOLUME_DETENT;
    }

    function readVolume() {
        const raw = Number(volumeInput.value);
        const value = detent(raw);
        if (value !== raw) volumeInput.value = String(value);
        volumeLabel.textContent = value + '%';
        return value;
    }

    function renderVolume(value) {
        if (volumeDragging || Date.now() < volumeHoldUntil || document.activeElement === volumeInput) return;
        volumeInput.value = String(value);
        volumeLabel.textContent = value + '%';
    }

    function holdVolume(milliseconds) {
        volumeDragging = false;
        volumeHoldUntil = Date.now() + milliseconds;
    }

    volumeInput.addEventListener('pointerdown', () => {
        volumeDragging = true;
    });
    volumeInput.addEventListener('focus', () => {
        volumeDragging = true;
    });
    volumeInput.addEventListener('pointerup', () => holdVolume(VOLUME_HOLD_MS));
    volumeInput.addEventListener('pointercancel', () => holdVolume(VOLUME_HOLD_MS));
    volumeInput.addEventListener('blur', () => holdVolume(VOLUME_HOLD_MS / 2));
    volumeInput.addEventListener('input', () => {
        readVolume();
    });
    volumeInput.addEventListener('change', () => {
        holdVolume(VOLUME_HOLD_MS);
        playerAction('volume', readVolume());
    });
    window.addEventListener('pointerup', () => {
        if (volumeDragging) holdVolume(VOLUME_HOLD_MS);
    });

    // ---- modals ----------------------------------------------------------

    const settingsModal = find('#settings-modal');

    function openSettings() {
        settingsModal.classList.add('open');
    }

    function closeSettings() {
        settingsModal.classList.remove('open');
    }

    find('#settings-btn').onclick = openSettings;
    find('#settings-close').onclick = closeSettings;
    find('#settings-cancel').onclick = closeSettings;
    settingsModal.addEventListener('click', event => {
        if (event.target === settingsModal) closeSettings();
    });

    const statsModal = find('#stats-modal');

    function openStats() {
        statsModal.classList.add('open');
        void loadStats();
    }

    function closeStats() {
        statsModal.classList.remove('open');
    }

    find('#stats-btn').onclick = openStats;
    find('#stats-close').onclick = closeStats;
    find('#stats-range').onchange = () => void loadStats();
    statsModal.addEventListener('click', event => {
        if (event.target === statsModal) closeStats();
    });

    const personalModal = find('#personal-modal');

    function openPersonal() {
        personalModal.classList.add('open');
        void loadPersonal();
    }

    function closePersonal() {
        personalModal.classList.remove('open');
    }

    find('#personal-btn').onclick = openPersonal;
    find('#personal-close').onclick = closePersonal;
    personalModal.addEventListener('click', event => {
        if (event.target === personalModal) closePersonal();
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        closeSettings();
        closeStats();
        closePersonal();
    });

    // ---- statistics ------------------------------------------------------

    function statCard(label, value) {
        return (
            '<div class="stat-card"><div class="stat-label">' +
            label +
            '</div><div class="stat-value">' +
            value +
            '</div></div>'
        );
    }

    function barChart(values, labels, asDuration) {
        const max = Math.max(1, ...values);
        const bars = values.map((value, index) => {
            const height = Math.max(2, Math.round((value / max) * 100));
            const caption = escapeHtml(labels[index]);
            const readout = escapeHtml(asDuration ? formatDuration(value) : String(value));
            return (
                '<div class="bar-wrap"><div class="bar" style="height:' +
                height +
                '%" title="' +
                caption +
                ': ' +
                readout +
                '"></div><span class="bar-label">' +
                caption +
                '</span></div>'
            );
        });
        return '<div class="bars">' + bars.join('') + '</div>';
    }

    function rankedList(rows) {
        const body = rows.length
            ? rows
                  .map((row, index) => '<div class="stat-row"><span class="stat-index">' + (index + 1) + '</span>' + row + '</div>')
                  .join('')
            : '<div class="small">No data yet.</div>';
        return '<div class="stat-list">' + body + '</div>';
    }

    function sourceGradient(sources) {
        const total = sources.reduce((sum, item) => sum + item.seconds, 0);
        if (!sources.length || !total) return '';
        const palette = ['#55d68b', '#7c9cff', '#ffb454', '#ff7272', '#c084fc', '#5eead4'];
        let cursor = 0;
        const stops = sources.map((source, index) => {
            const start = cursor;
            cursor += (source.seconds / total) * 100;
            return palette[index % palette.length] + ' ' + start + '% ' + cursor + '%';
        });
        return 'conic-gradient(' + stops.join(',') + ')';
    }

    function renderPersonal(data) {
        const tracks = data.tracks || [];
        const rows = tracks
            .map(item => {
                return (
                    '<div class="stat-row"><span class="stat-main">' +
                    escapeHtml(item.title) +
                    '<br><span class="stat-sub">' +
                    escapeHtml(item.author) +
                    ' · ' +
                    escapeHtml(item.source) +
                    ' · ' +
                    formatClock(item.seconds * 1000) +
                    ' each</span></span><span class="stat-sub">' +
                    item.plays +
                    ' play' +
                    (item.plays === 1 ? '' : 's') +
                    '</span></div>'
                );
            })
            .join('');
        find('#personal-content').innerHTML =
            '<div class="stat-cards">' +
            statCard('Hours listened', formatHours(data.listenedSeconds || 0)) +
            statCard('Songs played', data.totalPlays || 0) +
            statCard('Unique songs', data.uniqueTracks || 0) +
            '</div><div class="stats-block"><h3>Songs you requested</h3>' +
            (rows ? '<div class="stat-list">' + rows + '</div>' : '<div class="small">No requested songs yet.</div>') +
            '</div>';
    }

    async function loadPersonal() {
        const content = find('#personal-content');
        content.innerHTML = '<div class="small">Loading your statistics…</div>';
        try {
            const data = await request('/api/me/stats?guildId=' + encodeURIComponent(state.guildId));
            renderPersonal(data);
        } catch (error) {
            content.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
        }
    }

    function trackRow(track) {
        const title = escapeHtml(track.title);
        const linked =
            track.uri && /^https?:/i.test(track.uri)
                ? '<a href="' + escapeHtml(track.uri) + '" target="_blank" rel="noopener">' + title + '</a>'
                : title;
        const icon = track.icon
            ? '<img class="service-icon" src="' + escapeHtml(safeUrl(track.icon)) + '" alt="">'
            : '';
        return (
            '<span class="stat-main">' +
            icon +
            linked +
            '<br><span class="stat-sub">' +
            escapeHtml(track.author) +
            ' · ' +
            formatDuration(track.seconds) +
            '</span></span>'
        );
    }

    function listenerRow(listener) {
        return (
            '<img class="stat-avatar" src="' +
            escapeHtml(safeUrl(listener.avatar || '')) +
            '" alt="">' +
            '<span class="stat-main">' +
            escapeHtml(listener.name || listener.userId) +
            '<br><span class="stat-sub">' +
            formatDuration(listener.seconds) +
            '</span></span>'
        );
    }

    function commandRow(command) {
        return (
            '<span class="stat-main">' +
            escapeHtml(command.command) +
            '<br><span class="stat-sub">' +
            command.count +
            ' uses</span></span>'
        );
    }

    function renderStats(data) {
        const palette = ['#55d68b', '#7c9cff', '#ffb454', '#ff7272', '#c084fc', '#5eead4'];
        const gradient = sourceGradient(data.sources);
        const legend = data.sources.length
            ? data.sources
                  .map((source, index) => {
                      const icon = source.icon
                          ? '<img class="service-icon" src="' + escapeHtml(safeUrl(source.icon)) + '" alt="">'
                          : '';
                      return (
                          '<span><i class="dot" style="background:' +
                          palette[index % palette.length] +
                          '"></i>' +
                          icon +
                          escapeHtml(source.source) +
                          ' — ' +
                          formatDuration(source.seconds) +
                          '</span>'
                      );
                  })
                  .join('')
            : '<span>No tracks yet.</span>';

        find('#stats-content').innerHTML =
            '<div class="stat-cards">' +
            statCard('Listening time', formatDuration(data.totals.seconds)) +
            statCard('Sessions', data.totals.sessions) +
            statCard('Game sessions', data.totals.gameSessions) +
            statCard('Sources', data.sources.length) +
            '</div>' +
            '<div class="stats-grid"><div class="stats-block"><h3>Listening time by day</h3>' +
            barChart(
                data.days.map(entry => entry.seconds),
                data.days.map(entry => entry.day.slice(5)),
                true
            ) +
            '</div><div class="stats-block"><h3>Track types</h3><div class="pie ' +
            (gradient ? '' : 'empty') +
            '" style="' +
            (gradient ? 'background:' + gradient : '') +
            '"></div><div class="legend">' +
            legend +
            '</div></div></div>' +
            '<div class="stats-grid two"><div class="stats-block"><h3>Listening time by hour</h3>' +
            barChart(
                data.hours.map(entry => entry.seconds),
                data.hours.map(entry => pad(entry.hour) + ':00'),
                true
            ) +
            '</div><div class="stats-block"><h3>Listening time by weekday</h3>' +
            barChart(
                data.weekdays.map(entry => entry.seconds),
                ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                true
            ) +
            '</div></div>' +
            '<div class="stats-grid two"><div class="stats-block"><h3>Most time played</h3>' +
            rankedList(data.topTracks.map(trackRow)) +
            '</div><div class="stats-block"><h3>Most time listened</h3>' +
            rankedList(data.topListeners.map(listenerRow)) +
            '</div></div>' +
            '<div class="stats-block"><h3>Top commands</h3>' +
            rankedList(data.topCommands.map(commandRow)) +
            '</div>';
    }

    async function loadStats() {
        if (!state.guildId) return;
        const content = find('#stats-content');
        content.innerHTML = '<div class="small">Loading statistics…</div>';
        try {
            const days = find('#stats-range').value;
            const data = await request('/api/stats?guildId=' + encodeURIComponent(state.guildId) + '&days=' + days);
            renderStats(data);
        } catch (error) {
            content.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
        }
    }

    find('#stats-clear').onclick = async () => {
        if (!state.guildId) return;
        if (!window.confirm('Clear all statistics and game scores for this server? This cannot be undone.')) return;
        try {
            await postJson('/api/stats/clear', { guildId: state.guildId });
            notify('Statistics cleared');
            await loadStats();
        } catch (error) {
            notify(error.message, true);
        }
    };

    // ---- settings save / logout -----------------------------------------

    find('#save').onclick = async () => {
        const values = {};
        for (const field of document.querySelectorAll('#settings input, #settings select')) {
            values[field.dataset.key] = field.value;
        }
        try {
            await postJson('/api/settings', { guildId: state.guildId, settings: values });
            await loadState();
            closeSettings();
            notify('Settings saved');
        } catch (error) {
            notify(error.message, true);
        }
    };

    find('#logout-btn').onclick = async () => {
        try {
            await fetch('/auth/logout', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-dashboard-csrf': state.csrf },
                body: '{}',
            });
        } finally {
            window.location.href = '/';
        }
    };

    // ---- interaction wiring ---------------------------------------------

    document.querySelectorAll('[data-player]').forEach(button => {
        button.onclick = () => playerAction(button.dataset.player);
    });

    progressWrap.addEventListener('mousemove', event => showProgressTip(event.clientX));
    progressWrap.addEventListener('mouseleave', hideProgressTip);
    progressWrap.addEventListener('click', event => {
        if (!state.access.controls) return;
        const ratio = pointerRatio(event.clientX);
        void seekTo(ratio * progress.duration);
    });
    progressWrap.addEventListener('keydown', event => {
        if (!state.access.controls) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        void seekTo(projectedPosition() + (event.key === 'ArrowRight' ? 5000 : -5000));
    });

    function animationFrame() {
        paintProgress();
        window.requestAnimationFrame(animationFrame);
    }

    boot().catch(error => {
        find('#status').textContent = 'Error';
        notify(error.message, true);
    });
    window.setInterval(pollPlayer, POLL_MS);
    window.requestAnimationFrame(animationFrame);
})();
`;
