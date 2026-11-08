import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import config from '../dist/config.js';
import { Utils } from '../dist/lib/Utils.js';

const originalMode = config.botStatusMode;
const originalGuild = config.guildId;
const originalActivity = config.botActivity;

function fakeClient(queueEntries = []) {
    const calls = [];
    return {
        calls,
        user: {
            setActivity: activity => calls.push({ type: 'activity', activity }),
            setPresence: presence => calls.push({ type: 'presence', presence }),
        },
        queue: new Map(queueEntries),
    };
}

afterEach(() => {
    config.botStatusMode = originalMode;
    config.guildId = originalGuild;
    config.botActivity = originalActivity;
});

test('static status ignores playback', () => {
    config.botStatusMode = 'static';
    config.botActivity = 'Bootstrap DJ';
    const client = fakeClient([['g1', { current: { info: { title: 'Song' } } }]]);

    Utils.updateStatus(client, 'g1');

    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].type, 'presence');
    assert.equal(client.calls[0].presence.activities[0].name, 'Bootstrap DJ');
});

test('track status follows only the configured guild and falls back when empty', () => {
    config.botStatusMode = 'track';
    config.guildId = 'g1';
    const player = { current: { info: { title: 'Song' } } };
    const client = fakeClient([['g1', player]]);

    Utils.updateStatus(client, 'g1');
    assert.equal(client.calls[0].activity.name, '🎶 | Song');

    player.current = null;
    Utils.updateStatus(client, 'g1');
    assert.equal(client.calls[1].type, 'presence');

    Utils.updateStatus(client, 'g2');
    assert.equal(client.calls.length, 2, 'other guilds must not replace the configured status');
});

test('count status reports active servers without leaking a song title', () => {
    config.botStatusMode = 'count';
    const client = fakeClient([
        ['g1', { current: { info: { title: 'One' } } }],
        ['g2', { current: { info: { title: 'Two' } } }],
        ['g3', { current: null }],
    ]);

    Utils.updateStatus(client, 'g1');

    assert.equal(client.calls[0].activity.name, 'music in 2 servers');
});
