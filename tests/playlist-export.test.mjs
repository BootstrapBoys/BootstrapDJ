import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlaylistExport, playlistExportFilename } from '../dist/lib/PlaylistExport.js';

function track(title) {
    return {
        encoded: `encoded:${title}`,
        info: {
            title,
            author: 'Artist',
            length: 60_000,
            uri: `https://example.test/${title}`,
            sourceName: 'youtube',
        },
    };
}

test('export preserves order and accepts legacy array rows', () => {
    const exported = buildPlaylistExport(
        'Road Trip',
        [
            { track: JSON.stringify(track('A')) },
            { track: JSON.stringify([track('B'), track('C')]) },
            { track: '{not json' },
            { track: JSON.stringify({ encoded: 'missing-info' }) },
            { track: JSON.stringify([track('D'), 42]) },
        ],
        new Date('2026-11-12T04:00:00Z')
    );

    assert.equal(exported.count, 4);
    assert.equal(exported.skipped, 3);

    const document = JSON.parse(exported.text);
    assert.equal(document.format, 'bootstrapdj-playlist');
    assert.equal(document.version, 1);
    assert.equal(document.exportedAt, '2026-11-12T04:00:00.000Z');
    assert.equal(document.playlist.name, 'Road Trip');
    assert.equal(document.playlist.trackCount, 4);
    assert.equal(document.playlist.skipped, 3);
    assert.deepEqual(
        document.playlist.tracks.map(entry => entry.info.title),
        ['A', 'B', 'C', 'D']
    );
    assert.equal(document.playlist.tracks[0].encoded, 'encoded:A');
});

test('an empty playlist produces an empty export document', () => {
    const exported = buildPlaylistExport('Empty', []);
    const document = JSON.parse(exported.text);

    assert.equal(exported.count, 0);
    assert.equal(exported.skipped, 0);
    assert.equal(document.playlist.trackCount, 0);
    assert.deepEqual(document.playlist.tracks, []);
});

test('attachment filenames are safe and always end in .json', () => {
    assert.equal(playlistExportFilename('Road Trip'), 'Road Trip.json');
    assert.equal(playlistExportFilename('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j.json');
    assert.equal(playlistExportFilename('   '), 'playlist.json');
});
