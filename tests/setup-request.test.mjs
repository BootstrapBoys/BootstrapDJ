import assert from 'node:assert/strict';
import test from 'node:test';

import { BaseGuildTextChannel, EmbedBuilder } from 'discord.js';
import { LoadType } from 'shoukaku';

import { setupStart } from '../dist/lib/SetupSystem.js';

function rawTrack(title, length = 1000) {
    return {
        encoded: `encoded-${title}`,
        info: {
            identifier: title,
            isSeekable: true,
            author: 'Artist',
            length,
            isStream: false,
            position: 0,
            title,
            uri: `https://music.example/${title}`,
            sourceName: 'deezer',
        },
    };
}

function makeHarness({ response, settings = {}, current = null } = {}) {
    const sent = [];
    const edits = [];
    const player = {
        guildId: 'guild',
        current,
        queue: [],
        buildTrack(raw, author) {
            return { encoded: raw.encoded, info: { ...raw.info, requester: author } };
        },
        enqueue(track) {
            this.queue.push(track);
        },
        async isPlaying() {
            if (!this.current && this.queue.length) this.current = this.queue.shift();
        },
        async persist() {},
    };
    const mock = {
        id: 'mock',
        edit: async payload => {
            edits.push(payload);
        },
    };
    const channel = Object.create(BaseGuildTextChannel.prototype);
    Object.assign(channel, {
        id: 'text',
        guild: { id: 'guild' },
        messages: { fetch: async () => mock },
        send: async payload => {
            sent.push(payload);
            return { delete: async () => {} };
        },
    });
    const client = {
        user: { username: 'Bot', displayAvatarURL: () => undefined },
        config: {
            maxQueueSize: 100,
            maxPlaylistSize: 100,
            prefixSearchEngine: 'ytsearch',
            deleteAfter: 0,
            links: { img: null },
            icons: {},
        },
        color: { red: 0xff0000, green: 0x00ff00, main: 0x2f3136 },
        embed: () => new EmbedBuilder(),
        utils: { formatTime: ms => `${Math.round(ms / 1000)}s` },
        queue: { search: async () => response, hasNode: true },
        db: {
            getSetup: async () => ({ messageId: 'mock', textId: 'text' }),
            getGuildSettings: async () => settings,
        },
    };
    const message = {
        guild: { id: 'guild' },
        author: { id: 'user', toString: () => 'user#0001' },
        channel,
        content: 'query',
    };
    return { client, player, message, sent, edits };
}

test('a failed setup search reports the failure instead of dropping it', async () => {
    const harness = makeHarness({ response: null });

    await setupStart(harness.client, 'query', harness.player, harness.message);

    assert.equal(harness.sent.length, 1);
    assert.match(harness.sent[0].embeds[0].data.description, /error while searching/);
});

test('a setup playlist reports the accepted count, not the requested total', async () => {
    const harness = makeHarness({
        response: {
            loadType: LoadType.PLAYLIST,
            data: { tracks: [rawTrack('Long', 2000), rawTrack('Short A'), rawTrack('Short B')] },
        },
        settings: { maxtracklength: '1' },
    });

    await setupStart(harness.client, 'query', harness.player, harness.message);

    const descriptions = harness.sent.map(payload => payload.embeds[0].data.description);
    assert.ok(descriptions.some(text => /Added 2 tracks to the queue \(1 skipped\)/.test(text)));
});

test('the setup panel shows the actually playing track after a single request', async () => {
    const playing = { info: { title: 'already playing', uri: 'https://x/current' } };
    const harness = makeHarness({
        response: { loadType: LoadType.TRACK, data: rawTrack('requested') },
        current: playing,
    });

    await setupStart(harness.client, 'query', harness.player, harness.message);

    assert.equal(harness.edits.length, 1);
    assert.match(harness.edits[0].embeds[0].data.description, /already playing/);
    assert.doesNotMatch(harness.edits[0].embeds[0].data.description, /requested/);
});

test('the setup panel does not report the first playlist track as current', async () => {
    const playing = { info: { title: 'already playing', uri: 'https://x/current' } };
    const harness = makeHarness({
        response: {
            loadType: LoadType.PLAYLIST,
            data: { tracks: [rawTrack('playlist first'), rawTrack('playlist second')] },
        },
        current: playing,
    });

    await setupStart(harness.client, 'query', harness.player, harness.message);

    assert.equal(harness.edits.length, 1);
    assert.match(harness.edits[0].embeds[0].data.description, /already playing/);
    assert.doesNotMatch(harness.edits[0].embeds[0].data.description, /playlist first/);
});
