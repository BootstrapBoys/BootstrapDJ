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
    const POLL_MS = 2000;
    const VOLUME_DETENT = 5;
    const VOLUME_HOLD_MS = 1200;
    const TOAST_MS = 2500;

    const state = {
        guildId: null,
        csrf: '',
        guilds: [],
        data: null,
        language: 'en-US',
        access: { member: false, owner: false, admin: false, controls: false, settings: false, listen: false },
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

    const LANGUAGES = [
        { value: 'en-US', label: 'English (United States)' },
        { value: 'en-GB', label: 'English (United Kingdom)' },
    ];

    const DASHBOARD_COPY = {
        'en-US': {
            settingsTitle: 'Settings',
            settingsCancel: 'Cancel',
            settingsSave: 'Save settings',
            languageLabel: 'Language',
            languageDescription:
                'Language used by the bot for this server. English (United States) is the fallback.',
        },
        'en-GB': {
            settingsTitle: 'Settings',
            settingsCancel: 'Cancel',
            settingsSave: 'Save settings',
            languageLabel: 'Language',
            languageDescription:
                'Language used by the bot for this server. English (United States) is the fallback language.',
        },
    };

    function copy(key, fallback) {
        return (DASHBOARD_COPY[state.language] || DASHBOARD_COPY['en-US'])[key] || fallback;
    }

    const GROUPS = [
        { title: 'Language', keys: ['language'] },
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
        {
            title: 'Browser mode',
            keys: ['dashboardvoicechannel', 'dashboardvoicepriority', 'audiotapallowall', 'audiotaproles'],
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
        language: 'Language',
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
        dashboardvoicechannel: 'Dashboard voice channel ID',
        dashboardvoicepriority: 'Discord takes priority',
        audiotapallowall: 'Allow all members to listen',
        audiotaproles: 'Listening role IDs',
        timeoutlisteners: 'Listener timeout (s)',
        timeoutpause: 'Pause timeout (s)',
        timeoutplaying: 'Idle playback timeout (s)',
        timeoutconfirmation: 'Confirmation prompt (s)',
        commandchannel: 'Command channel ID',
        voicechannel: 'Required voice channel ID',
        disabledcommands: 'Disabled commands',
    };

    const DESCRIPTIONS = {
        language:
            'Language used by the bot for this server. English (United States) is the fallback.',
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
        dashboardvoicechannel:
            'Voice channel ID the bot joins for browser-only playback. Blank uses the host DASHBOARD_VOICE_CHANNEL_ID fallback.',
        dashboardvoicepriority:
            'When Dashboard browser playback is active, a Discord user’s play command clears that queue and moves the bot to their voice channel. Disable to keep browser playback in place.',
        audiotapallowall:
            'Allow every member of this server to listen to dashboard audio. When disabled, only the listed roles, owner, and administrators may listen.',
        audiotaproles:
            'Comma-separated Discord role IDs allowed to listen when “Allow all members” is disabled. Invalid entries are ignored.',
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
        'audiotapallowall',
        'dashboardvoicepriority',
    ]);

    const WIDE_KEYS = new Set([
        'autoplayseeds',
        'disabledcommands',
        'announcechannel',
        'commandchannel',
        'voicechannel',
        'dashboardvoicechannel',
        'audiotaproles',
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
        const label =
            key === 'language'
                ? copy('languageLabel', LABELS[key] || key)
                : LABELS[key] || key;
        const description =
            key === 'language'
                ? copy('languageDescription', DESCRIPTIONS[key] || '')
                : DESCRIPTIONS[key];
        heading.appendChild(element('span', '', label));
        if (description) {
            const help = element('span', 'help', '?');
            help.tabIndex = 0;
            help.setAttribute('role', 'note');
            help.setAttribute('aria-label', description);
            help.dataset.tip = description;
            heading.appendChild(help);
        }
        box.appendChild(heading);

        let input;
        if (key === 'language') {
            input = element('select');
            for (const language of LANGUAGES) {
                input.appendChild(option(language.value, language.label));
            }
            input.value = value || 'en-US';
        } else if (key === 'autoplaysource') {
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
        state.language = data.settings?.language || 'en-US';
        renderPlayer(data);
        renderFilters(data.filters);
        refreshAudioForFilterChange(data.filters);
        renderSettings(data.settings);
        setListenUi();
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
        find('#queue-add').style.display = state.access.controls ? '' : 'none';
        find('#filters-panel').style.display = state.access.settings ? '' : 'none';
        find('#stats-clear').style.display = state.access.owner ? '' : 'none';
        setListenUi();
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

    let playerPollInFlight = false;
    let eventSource = null;
    let fallbackPollTimer = 0;

    async function pollPlayer() {
        const guildId = state.guildId;
        if (!guildId || !state.data || playerPollInFlight || document.visibilityState !== 'visible') {
            return;
        }
        playerPollInFlight = true;
        try {
            const payload = await request('/api/player-state?guildId=' + encodeURIComponent(guildId));
            if (state.guildId !== guildId) return;
            state.data.player = payload.player;
            renderPlayer(payload);
        } catch {
            // The next tick retries; a transient 503 should not spam the UI.
        } finally {
            playerPollInFlight = false;
        }
    }

    function stopLiveUpdates() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        if (fallbackPollTimer) {
            window.clearInterval(fallbackPollTimer);
            fallbackPollTimer = 0;
        }
    }

    function startFallbackPolling() {
        if (fallbackPollTimer || !state.guildId) return;
        fallbackPollTimer = window.setInterval(pollPlayer, POLL_MS);
    }

    function startLiveUpdates() {
        stopLiveUpdates();
        if (!state.guildId || document.visibilityState !== 'visible') return;

        const oauth = document.body.dataset.oauth === '1';
        if (!oauth || !('EventSource' in window)) {
            startFallbackPolling();
            return;
        }

        const guildId = state.guildId;
        const source = new EventSource('/api/events?guildId=' + encodeURIComponent(guildId));
        eventSource = source;
        source.onmessage = event => {
            if (state.guildId !== guildId || !state.data) return;
            try {
                const payload = JSON.parse(event.data);
                state.data.player = payload.player;
                renderPlayer(payload);
            } catch {
                // Ignore a malformed event and wait for the next snapshot.
            }
        };
        source.onerror = () => {
            if (eventSource !== source) return;
            source.close();
            eventSource = null;
            startFallbackPolling();
        };
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
            stopAudio();
            stopLiveUpdates();
            applyAccess();
            void loadState().then(() => startLiveUpdates());
        };
        applyAccess();
        await loadState();
        startLiveUpdates();
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

    async function addSong() {
        if (!state.access.controls) {
            notify('Read-only dashboard access', true);
            return;
        }
        const input = find('#queue-query');
        const button = find('#queue-add-btn');
        const query = input.value.trim();
        if (!query) return;
        button.disabled = true;
        try {
            const result = await postJson('/api/play', { guildId: state.guildId, query });
            const count = result.added || 1;
            notify(
                'Added ' +
                    count +
                    ' track' +
                    (count === 1 ? '' : 's') +
                    (result.title ? ': ' + result.title : '') +
                    (result.skipped ? ' (' + result.skipped + ' skipped)' : '')
            );
            input.value = '';
            await loadState();
        } catch (error) {
            notify(error.message, true);
        } finally {
            button.disabled = false;
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

    // ---- audio tap (WebCodecs) ------------------------------------------

    const TAP_RECONNECT_MS = 1000;
    const TAP_FRAME_MS = 20;
    const TAP_DECODER_CONFIG = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 };

    const audio = {
        status: 'off',
        muted: false,
        context: null,
        gain: null,
        analyser: null,
        decoder: null,
        controller: null,
        generation: 0,
        nextTime: 0,
        lastTimestamp: -1,
        frames: 0,
        decoded: 0,
        outputs: 0,
        copyErrors: 0,
        lastError: '',
        drops: 0,
        sources: new Set(),
        reconnectTimer: 0,
    };

    let filterSignature = '';
    let filterRefreshTimer = 0;

    function snapshotFilters(filters) {
        return (filters || [])
            .map(filter => filter.id + ':' + (filter.active ? '1' : '0') + ':' + (filter.current ?? ''))
            .join('|');
    }

    /**
     * Lavalink applies the filter immediately, but the browser may still have
     * several seconds of unfiltered frames scheduled ahead of the audio clock.
     * Reconnect the tap so the listener starts at the live, filtered frame
     * instead of waiting for that backlog to drain.
     */
    function refreshAudioForFilterChange(filters) {
        const nextSignature = snapshotFilters(filters);
        const changed = filterSignature !== '' && nextSignature !== filterSignature;
        filterSignature = nextSignature;
        if (!changed || audio.status !== 'on') return;
        window.clearTimeout(filterRefreshTimer);
        filterRefreshTimer = window.setTimeout(() => {
            void restartAudioForFilter();
        }, 120);
    }

    async function restartAudioForFilter() {
        if (audio.status !== 'on') return;
        audio.status = 'starting';
        setListenUi();
        try {
            await connectAudioTap();
        } catch {
            scheduleReconnect(audio.generation);
        }
    }

    function audioSupported() {
        return typeof window.AudioDecoder === 'function'
            && typeof window.EncodedAudioChunk === 'function';
    }

    function setListenUi() {
        const button = find('#listen-btn');
        const label = find('#listen-label');
        const disconnectButton = find('#disconnect-btn');
        if (!button || !label) return;
        const available = Boolean(state.data && state.data.audio && state.data.audio.available);
        const canListen = Boolean(state.data && state.data.audio && state.data.audio.canListen);
        if ((!available || !canListen) && audio.status !== 'off') {
            stopAudio();
            return;
        }
        const active = audio.status === 'on' || audio.status === 'starting';
        button.style.display = available ? '' : 'none';
        button.disabled = !canListen;
        button.classList.toggle('on', active && !audio.muted);
        button.classList.toggle('muted', active && audio.muted);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (disconnectButton) {
            disconnectButton.style.display = audio.status === 'off' ? 'none' : '';
        }
        if (audio.status === 'starting') {
            label.textContent = 'Connecting';
            button.title = 'Connecting to the audio tap';
        } else if (audio.status === 'on' && audio.muted) {
            label.textContent = 'Unmute';
            button.title = 'Unmute this browser only';
        } else if (audio.status === 'on') {
            label.textContent = 'Mute';
            button.title = 'Mute this browser only';
        } else if (!canListen) {
            label.textContent = 'Listen';
            button.title = 'Your roles do not allow listening';
        } else {
            label.textContent = 'Listen';
            button.title = 'Play this browser audio from the bot';
        }
    }

    function audioRms() {
        if (!audio.analyser) return 0;
        const samples = new Float32Array(audio.analyser.fftSize);
        audio.analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        return Math.sqrt(sum / samples.length);
    }

    function stopScheduledSources() {
        for (const source of audio.sources) {
            try {
                source.stop();
            } catch {
                // already stopped
            }
            source.disconnect();
        }
        audio.sources.clear();
    }

    function resetDecoder() {
        stopScheduledSources();
        if (audio.decoder) {
            try {
                // reset() returns the decoder to "unconfigured"; a track change
                // must reconfigure it before the next packet is fed.
                audio.decoder.reset();
                audio.decoder.configure(TAP_DECODER_CONFIG);
            } catch {
                // a closed decoder is replaced on reconnect
            }
        }
        audio.lastTimestamp = -1;
        if (audio.context) audio.nextTime = audio.context.currentTime + 0.15;
    }

    function closeDecoder() {
        if (!audio.decoder) return;
        try {
            audio.decoder.close();
        } catch {
            // already closed
        }
        audio.decoder = null;
    }

    function audioDataHandler(data) {
        audio.outputs += 1;
        try {
            if (!audio.context || !audio.gain || audio.status === 'off') return;
            const frames = data.numberOfFrames;
            const channels = Math.min(2, data.numberOfChannels);
            const buffer = audio.context.createBuffer(2, frames, data.sampleRate);
            for (let channel = 0; channel < channels; channel += 1) {
                data.copyTo(buffer.getChannelData(channel), {
                    planeIndex: channel,
                    format: 'f32-planar',
                });
            }
            const source = audio.context.createBufferSource();
            source.buffer = buffer;
            source.connect(audio.gain);
            const now = audio.context.currentTime;
            if (audio.nextTime < now - 0.5) audio.nextTime = now + 0.1;
            const startAt = Math.max(now + 0.02, audio.nextTime);
            source.start(startAt);
            audio.nextTime = startAt + buffer.duration;
            audio.sources.add(source);
            source.onended = () => {
                audio.sources.delete(source);
                source.disconnect();
            };
            audio.decoded += 1;
        } catch (error) {
            audio.copyErrors += 1;
            audio.lastError = (error && error.message ? error.message : String(error))
                + ' frames=' + data.numberOfFrames
                + ' channels=' + data.numberOfChannels
                + ' sampleRate=' + data.sampleRate
                + ' format=' + data.format;
        } finally {
            data.close();
        }
    }
    function audioDecoderError(error) {
        audio.lastError = error && error.message ? error.message : String(error);
        notify('Audio decode failed: ' + (error && error.message ? error.message : 'unknown error'), true);
        stopAudio();
    }

    function readTapPosition(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, 11);
        return Number(view.getBigInt64(3));
    }

    function decodeTapPacket(payload, position) {
        if (!audio.decoder) return;
        const timestamp = Math.max(position * 1000, audio.lastTimestamp + TAP_FRAME_MS * 1000);
        audio.lastTimestamp = timestamp;
        try {
            audio.decoder.decode(new EncodedAudioChunk({
                type: 'key',
                timestamp,
                data: payload.slice(),
            }));
        } catch {
            // A decoder reset lands before the next trackStart frame.
        }
    }

    function handleTapControl(event) {
        if (!event) return;
        if (event.event === 'trackStart') {
            resetDecoder();
            return;
        }
        if (event.event === 'ping' && typeof event.droppedFrames === 'number') {
            audio.drops = event.droppedFrames;
            return;
        }
        if (event.event === 'playerDestroyed') {
            stopAudio();
        }
    }

    async function pumpTap(body, generation) {
        const reader = body.getReader();
        let buffer = new Uint8Array(0);
        for (;;) {
            const result = await reader.read();
            if (generation !== audio.generation) {
                await reader.cancel().catch(() => {});
                return;
            }
            if (result.done) break;
            const chunk = result.value;
            const merged = new Uint8Array(buffer.length + chunk.length);
            merged.set(buffer, 0);
            merged.set(chunk, buffer.length);
            buffer = merged;

            for (;;) {
                if (buffer.length < 3) break;
                const type = buffer[0];
                const length = (buffer[1] << 8) | buffer[2];
                if (type === 1) {
                    if (buffer.length < 11 + length) break;
                    const position = readTapPosition(buffer);
                    const payload = buffer.subarray(11, 11 + length);
                    audio.frames += 1;
                    decodeTapPacket(payload, position);
                    buffer = buffer.subarray(11 + length);
                } else if (type === 2) {
                    if (buffer.length < 3 + length) break;
                    const json = new TextDecoder().decode(buffer.subarray(3, 3 + length));
                    buffer = buffer.subarray(3 + length);
                    try {
                        handleTapControl(JSON.parse(json));
                    } catch {
                        // ignore malformed control frames
                    }
                } else {
                    throw new Error('unknown audio tap frame');
                }
            }
        }
        throw new Error('audio tap stream ended');
    }

    function scheduleReconnect(generation) {
        window.clearTimeout(audio.reconnectTimer);
        audio.reconnectTimer = window.setTimeout(() => {
            if (generation !== audio.generation || audio.status === 'off') return;
            audio.status = 'starting';
            setListenUi();
            void connectAudioTap().catch(() => scheduleReconnect(audio.generation));
        }, TAP_RECONNECT_MS);
    }

    async function connectAudioTap() {
        if (
            !state.guildId ||
            !state.data ||
            !state.data.audio ||
            !state.data.audio.available ||
            !state.data.audio.canListen
        ) {
            throw new Error('The audio tap is not available for this guild');
        }
        closeDecoder();
        stopScheduledSources();
        audio.generation += 1;
        const generation = audio.generation;
        if (audio.controller) {
            audio.controller.abort();
            audio.controller = null;
        }
        audio.decoder = new AudioDecoder({ output: audioDataHandler, error: audioDecoderError });
        audio.decoder.configure(TAP_DECODER_CONFIG);
        audio.lastTimestamp = -1;
        audio.nextTime = audio.context.currentTime + 0.15;
        audio.controller = new AbortController();

        const headers = {};
        const token = storedToken();
        if (token) headers['x-dashboard-token'] = token;
        const response = await fetch('/api/audio?guildId=' + encodeURIComponent(state.guildId), {
            method: 'GET',
            headers,
            credentials: 'same-origin',
            signal: audio.controller.signal,
        });
        if (generation !== audio.generation) return;
        if (response.status === 404) {
            stopAudio();
            notify('The bot has no active player in this server.', true);
            return;
        }
        if (response.status === 401 || response.status === 403) {
            stopAudio();
            notify('This dashboard session cannot listen to audio.', true);
            return;
        }
        if (response.status === 501 || response.status === 503) {
            response.body?.cancel?.();
            stopAudio();
            notify('Audio is not available on this node.', true);
            return;
        }
        if (response.status === 429) {
            response.body?.cancel?.();
            stopAudio();
            notify('Audio is rate-limited; try again shortly.', true);
            return;
        }
        if (!response.ok) {
            response.body?.cancel?.();
            throw new Error('Audio tap HTTP ' + response.status);
        }
        if (!response.body) throw new Error('Audio tap returned no body');
        audio.status = 'on';
        if (audio.gain) audio.gain.gain.value = audio.muted ? 0 : 1;
        setListenUi();
        void pumpTap(response.body, generation).catch(() => {
            if (generation !== audio.generation || audio.status === 'off') return;
            audio.status = 'starting';
            setListenUi();
            scheduleReconnect(generation);
        });
    }

    async function startAudio() {
        if (!audioSupported()) {
            notify('Audio playback needs Chrome or Edge (WebCodecs is unavailable).', true);
            return;
        }
        if (
            !state.data ||
            !state.data.audio ||
            !state.data.audio.available ||
            !state.data.audio.canListen
        ) {
            notify('The audio tap is not available on this dashboard.', true);
            return;
        }
        audio.status = 'starting';
        audio.muted = false;
        setListenUi();
        try {
            if (!audio.context) {
                audio.context = new AudioContext({ sampleRate: 48000 });
                audio.gain = audio.context.createGain();
                audio.analyser = audio.context.createAnalyser();
                audio.analyser.fftSize = 2048;
                audio.gain.connect(audio.analyser);
                audio.analyser.connect(audio.context.destination);
            }
            await audio.context.resume();
            await connectAudioTap();
        } catch (error) {
            audio.status = 'off';
            setListenUi();
            notify(error && error.message ? error.message : 'Could not start dashboard audio', true);
        }
    }

    function stopAudio() {
        audio.generation += 1;
        window.clearTimeout(audio.reconnectTimer);
        if (audio.controller) {
            audio.controller.abort();
            audio.controller = null;
        }
        closeDecoder();
        stopScheduledSources();
        if (audio.gain) audio.gain.gain.value = 1;
        audio.status = 'off';
        audio.muted = false;
        setListenUi();
    }

    function toggleAudio() {
        if (audio.status === 'off') {
            void startAudio();
            return;
        }
        if (audio.status === 'starting') {
            stopAudio();
            return;
        }
        audio.muted = !audio.muted;
        if (audio.gain) audio.gain.gain.value = audio.muted ? 0 : 1;
        setListenUi();
    }

    const listenButton = find('#listen-btn');
    if (listenButton) listenButton.addEventListener('click', toggleAudio);
    const disconnectButton = find('#disconnect-btn');
    if (disconnectButton) disconnectButton.addEventListener('click', stopAudio);

    window.__bdjAudio = {
        debug: () => ({
            status: audio.status,
            muted: audio.muted,
            frames: audio.frames,
            decoded: audio.decoded,
            drops: audio.drops,
            gain: audio.gain ? audio.gain.gain.value : null,
            rms: audioRms(),
            sampleRate: audio.context ? audio.context.sampleRate : null,
            context: audio.context ? audio.context.state : null,
            outputs: audio.outputs,
            copyErrors: audio.copyErrors,
            lastError: audio.lastError,
            decoderState: audio.decoder ? audio.decoder.state : null,
            leadMs:
                audio.context && audio.nextTime
                    ? Math.max(0, (audio.nextTime - audio.context.currentTime) * 1000)
                    : 0,
            filterSignature,
        }),
        toggle: toggleAudio,
        stop: stopAudio,
    };

    // ---- playlists --------------------------------------------------------

    let playlistSelected = '';

    function renderPlaylistList(playlists) {
        const container = find('#playlist-list');
        container.textContent = '';
        if (!playlists.length) {
            container.appendChild(element('div', 'playlist-empty', 'No playlists yet.'));
            return;
        }
        for (const item of playlists) {
            const row = element('div', 'playlist-row' + (item.name === playlistSelected ? ' active' : ''));
            row.appendChild(element('span', 'playlist-name', item.name));
            row.appendChild(
                element(
                    'span',
                    'small',
                    item.trackCount + ' track' + (item.trackCount === 1 ? '' : 's')
                )
            );
            row.onclick = () => {
                playlistSelected = item.name;
                renderPlaylistList(playlists);
                void loadPlaylistTracks(item.name);
            };
            container.appendChild(row);
        }
    }

    async function loadPlaylists() {
        try {
            const data = await request('/api/playlists');
            const playlists = data.playlists || [];
            if (playlistSelected && !playlists.some(item => item.name === playlistSelected)) {
                playlistSelected = '';
            }
            renderPlaylistList(playlists);
            if (!playlistSelected) {
                const detail = find('#playlist-detail');
                detail.textContent = '';
                detail.appendChild(element('div', 'small', 'Select a playlist to edit or load it.'));
                return;
            }
            await loadPlaylistTracks(playlistSelected);
        } catch (error) {
            notify(error.message, true);
        }
    }

    async function loadPlaylistTracks(name) {
        const detail = find('#playlist-detail');
        detail.textContent = '';
        detail.appendChild(element('div', 'small', 'Loading tracks…'));
        try {
            const data = await request('/api/playlists/tracks?name=' + encodeURIComponent(name));
            renderPlaylistDetail(name, data.tracks || []);
        } catch (error) {
            detail.textContent = '';
            detail.appendChild(element('div', 'error', error.message));
        }
    }

    function playlistActionButton(label, className) {
        const button = element('button', className || 'icon-btn', label);
        return button;
    }

    function renderPlaylistDetail(name, tracks) {
        const detail = find('#playlist-detail');
        detail.textContent = '';
        const head = element('div', 'playlist-detail-head');
        head.appendChild(element('h3', '', name));

        const rename = playlistActionButton('Rename');
        rename.onclick = async () => {
            const next = window.prompt('Rename playlist', name);
            if (!next || next.trim() === name) return;
            try {
                await postJson('/api/playlists', {
                    action: 'rename',
                    name,
                    newName: next.trim(),
                });
                playlistSelected = next.trim();
                notify('Playlist renamed');
                await loadPlaylists();
            } catch (error) {
                notify(error.message, true);
            }
        };
        head.appendChild(rename);

        const remove = playlistActionButton('Delete');
        remove.onclick = async () => {
            if (!window.confirm('Delete the playlist "' + name + '"? This cannot be undone.')) return;
            try {
                await postJson('/api/playlists', { action: 'delete', name });
                playlistSelected = '';
                notify('Playlist deleted');
                await loadPlaylists();
            } catch (error) {
                notify(error.message, true);
            }
        };
        head.appendChild(remove);

        const queuePlaylist = async (shuffle) => {
            try {
                const result = await postJson('/api/playlists/load', {
                    guildId: state.guildId,
                    name,
                    shuffle,
                });
                notify(
                    'Queued ' +
                        (result.queued || 0) +
                        ' track' +
                        ((result.queued || 0) === 1 ? '' : 's') +
                        ((result.skipped || 0) ? ' (' + result.skipped + ' skipped)' : '') +
                        (result.shuffled ? ' in shuffled order' : '')
                );
                closePlaylists();
                await loadState();
            } catch (error) {
                notify(error.message, true);
            }
        };

        const load = playlistActionButton('Load to queue', 'primary');
        load.disabled = !state.access.controls;
        load.title = state.access.controls
            ? 'Append this playlist to the current queue'
            : 'Playback controls are required';
        load.onclick = () => queuePlaylist(false);
        head.appendChild(load);

        const shuffleLoad = playlistActionButton('Shuffle & load');
        shuffleLoad.disabled = !state.access.controls;
        shuffleLoad.title = state.access.controls
            ? 'Append this playlist in random order without changing its saved order'
            : 'Playback controls are required';
        shuffleLoad.onclick = () => queuePlaylist(true);
        head.appendChild(shuffleLoad);
        detail.appendChild(head);

        if (!tracks.length) {
            detail.appendChild(element('div', 'playlist-empty', 'This playlist is empty.'));
        } else {
            tracks.forEach((track, index) => {
                const row = element('div', 'playlist-track');
                row.appendChild(element('span', 'track-pos', String(index + 1)));
                const main = element('div', 'track-main');
                const title = element('div', 'track-title');
                title.innerHTML = trackTitle(track);
                main.appendChild(title);
                const meta = element(
                    'div',
                    'track-meta',
                    (track.author || 'Unknown artist') +
                        ' · ' +
                        formatDuration(track.duration) +
                        (track.source ? ' · ' + track.source : '')
                );
                main.appendChild(meta);
                row.appendChild(main);
                const removeTrack = element('button', 'track-remove', 'Remove');
                removeTrack.title = 'Remove this track';
                removeTrack.onclick = async () => {
                    try {
                        await postJson('/api/playlists/tracks', {
                            action: 'removeAt',
                            name,
                            index: index + 1,
                        });
                        notify('Track removed');
                        await loadPlaylistTracks(name);
                        await loadPlaylists();
                    } catch (error) {
                        notify(error.message, true);
                    }
                };
                row.appendChild(removeTrack);
                detail.appendChild(row);
            });
        }

        const add = element('div', 'playlist-add');
        const query = element('input');
        query.id = 'playlist-add-query';
        query.placeholder = 'Song name, URL, or playlist URL';
        query.setAttribute('aria-label', 'Add a track to the playlist');
        const addButton = playlistActionButton('Add track', 'primary');
        addButton.onclick = async () => {
            const value = query.value.trim();
            if (!value) return;
            try {
                const result = await postJson('/api/playlists/tracks', {
                    action: 'add',
                    name,
                    query: value,
                });
                notify(
                    'Added ' +
                        (result.added || 0) +
                        ' track' +
                        ((result.added || 0) === 1 ? '' : 's') +
                        ((result.skipped || 0) ? ' (' + result.skipped + ' skipped)' : '')
                );
                query.value = '';
                await loadPlaylistTracks(name);
                await loadPlaylists();
            } catch (error) {
                notify(error.message, true);
            }
        };
        add.appendChild(query);
        add.appendChild(addButton);
        detail.appendChild(add);

        const clear = playlistActionButton('Clear playlist');
        clear.onclick = async () => {
            if (!window.confirm('Remove every track from "' + name + '"?')) return;
            try {
                await postJson('/api/playlists/tracks', { action: 'clear', name });
                notify('Playlist cleared');
                await loadPlaylistTracks(name);
                await loadPlaylists();
            } catch (error) {
                notify(error.message, true);
            }
        };
        detail.appendChild(clear);
    }

    // ---- modals ----------------------------------------------------------

    const settingsModal = find('#settings-modal');

    function openSettings() {
        find('#settings-title').textContent = copy('settingsTitle', 'Settings');
        find('#settings-cancel').textContent = copy('settingsCancel', 'Cancel');
        find('#save').textContent = copy('settingsSave', 'Save settings');
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

    const playlistsModal = find('#playlists-modal');

    function openPlaylists() {
        playlistsModal.classList.add('open');
        void loadPlaylists();
    }

    function closePlaylists() {
        playlistsModal.classList.remove('open');
    }

    find('#playlists-btn').onclick = openPlaylists;
    find('#playlists-close').onclick = closePlaylists;
    playlistsModal.addEventListener('click', event => {
        if (event.target === playlistsModal) closePlaylists();
    });
    find('#playlist-create').onclick = async () => {
        const input = find('#playlist-name');
        const name = input.value.trim();
        if (!name) return;
        try {
            await postJson('/api/playlists', { action: 'create', name });
            input.value = '';
            playlistSelected = name;
            notify('Playlist created');
            await loadPlaylists();
        } catch (error) {
            notify(error.message, true);
        }
    };
    find('#playlist-name').addEventListener('keydown', event => {
        if (event.key === 'Enter') find('#playlist-create').click();
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        closeSettings();
        closeStats();
        closePersonal();
        closePlaylists();
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

    function trackHref(track) {
        if (track.uri && /^https?:/i.test(track.uri)) return track.uri;
        const title = (track.title || '').trim();
        const author = (track.author || '').trim();
        if (!title) return '';
        return 'https://www.youtube.com/results?search_query=' + encodeURIComponent((title + ' ' + author).trim());
    }

    function trackTitle(track) {
        const title = escapeHtml(track.title);
        const href = trackHref(track);
        return href
            ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + title + '</a>'
            : title;
    }

    function renderPersonal(data) {
        const tracks = data.tracks || [];
        const rows = tracks
            .map(item => {
                return (
                    '<div class="stat-row"><span class="stat-main">' +
                    trackTitle(item) +
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
        const title = trackTitle(track);
        const icon = track.icon
            ? '<img class="service-icon" src="' + escapeHtml(safeUrl(track.icon)) + '" alt="">'
            : '';
        return (
            '<span class="stat-main">' +
            icon +
            title +
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

    // ---- PWA install / service worker ------------------------------------
    let installPrompt = null;
    const installButton = find('#install-btn');
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        installPrompt = event;
        if (installButton) installButton.style.display = '';
    });
    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        if (installButton) installButton.style.display = 'none';
        notify('BootstrapDJ installed');
    });
    if (installButton) {
        installButton.addEventListener('click', async () => {
            if (!installPrompt) return;
            const prompt = installPrompt;
            installPrompt = null;
            installButton.style.display = 'none';
            prompt.prompt();
            await prompt.userChoice.catch(() => null);
        });
    }
    if ('serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // The dashboard still works if the browser refuses the worker.
        });
    }

    // ---- interaction wiring ---------------------------------------------

    find('#queue-add-btn').onclick = () => void addSong();
    find('#queue-query').addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void addSong();
    });

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
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            startLiveUpdates();
            void pollPlayer();
        } else {
            stopLiveUpdates();
        }
    });
    window.addEventListener('beforeunload', stopLiveUpdates);
    window.requestAnimationFrame(animationFrame);
})();
`;
