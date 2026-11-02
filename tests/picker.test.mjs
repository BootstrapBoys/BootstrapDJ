import assert from 'node:assert/strict';
import test from 'node:test';

import { makeDispatcher, makeSong } from './helpers.mjs';

const candidate = (title, author, uri) => ({
    encoded: `${title}:${uri}`,
    info: {
        identifier: title,
        isSeekable: true,
        author,
        length: 1000,
        isStream: false,
        position: 0,
        title,
        uri,
        sourceName: 'deezer',
    },
});

test('same track re-searched (new encoded, same uri) is rejected', () => {
    const dispatcher = makeDispatcher();
    const played = makeSong('Hurt', { uri: 'https://deezer.com/track/1', encoded: 'FIRST' });
    dispatcher.history.push(played);

    const reFound = candidate('Hurt', 'A', 'https://deezer.com/track/1');
    assert.equal(dispatcher.chooseFrom([reFound]), null);
});

test('a genuinely new track is picked', () => {
    const dispatcher = makeDispatcher();
    dispatcher.history.push(makeSong('Hurt', { uri: 'https://deezer.com/track/1' }));

    const picked = dispatcher.chooseFrom([candidate('Other', 'A', 'https://deezer.com/track/2')]);

    assert.equal(picked?.info.title, 'Other');
    assert.equal(picked?.autoplay, false);
});

test('tracks queued but not played are rejected too', () => {
    const dispatcher = makeDispatcher();
    dispatcher.queue.push(makeSong('Queued', { uri: 'https://deezer.com/track/3' }));

    assert.equal(dispatcher.chooseFrom([candidate('Queued', 'A', 'https://deezer.com/track/3')]), null);
});

test('the last three artists are demoted, even in a thin mix', () => {
    const dispatcher = makeDispatcher();
    dispatcher.history.push(
        makeSong('h1', { uri: 'https://x/1', author: 'Parker Jack' }),
        makeSong('h2', { uri: 'https://x/2', author: 'Parker Jack' }),
        makeSong('h3', { uri: 'https://x/3', author: 'Parker Jack' })
    );

    // 23 tracks by the seed artist, 2 by someone else.
    const mix = [];
    for (let i = 0; i < 23; i++) {
        mix.push(candidate(`p${i}`, 'Parker Jack', `https://x/p${i}`));
    }
    mix.push(candidate('a1', 'Akon', 'https://x/a1'), candidate('a2', 'Akon', 'https://x/a2'));

    const authors = new Set();
    for (let i = 0; i < 30; i++) authors.add(dispatcher.chooseFrom(mix)?.info.author);

    assert.deepEqual([...authors], ['Akon']);
});

test('when only demoted artists exist it still returns a track', () => {
    const dispatcher = makeDispatcher();
    dispatcher.history.push(makeSong('h1', { uri: 'https://x/1', author: 'Parker Jack' }));

    const picked = dispatcher.chooseFrom([candidate('p1', 'Parker Jack', 'https://x/p1')]);

    assert.equal(picked?.info.author, 'Parker Jack');
});

test('an exhausted candidate list returns null instead of throwing', () => {
    const dispatcher = makeDispatcher();
    dispatcher.history.push(makeSong('only', { uri: 'https://x/only' }));

    assert.equal(dispatcher.chooseFrom([candidate('only', 'A', 'https://x/only')]), null);
});

test('autoplay weights the seed artist above unrelated tracks', () => {
    const dispatcher = makeDispatcher();
    const other = candidate('other', 'Other Artist', 'https://x/other');
    const seed = candidate('seed', 'Seed Artist', 'https://x/seed');
    const original = Math.random;
    Math.random = () => 0.3;
    try {
        assert.equal(dispatcher.chooseFrom([other, seed], { seedArtist: 'Seed Artist', relatedArtists: [] })?.info.author, 'Seed Artist');
    } finally {
        Math.random = original;
    }
});

test('related artists sit between the seed artist and strangers', () => {
    const dispatcher = makeDispatcher();
    const affinity = { seedArtist: 'Seed Artist', relatedArtists: ['Close Artist'] };
    assert.equal(dispatcher.affinityWeight(candidate('seed', 'Seed Artist', 'https://x/1'), affinity), 3);
    assert.equal(dispatcher.affinityWeight(candidate('close', 'Close Artist', 'https://x/2'), affinity), 2);
    assert.equal(dispatcher.affinityWeight(candidate('other', 'Other Artist', 'https://x/3'), affinity), 1);
});

test('pickForSeed uses the mix even when it contains only the seed artist', async () => {
    const seed = makeSong('seed', { author: 'Seed Artist', uri: 'https://x/seed' });
    const dispatcher = makeDispatcher({ seed });
    const mix = [candidate('next', 'Seed Artist', 'https://x/next')];
    let seen = null;
    dispatcher.relatedTracks = async () => mix;
    dispatcher.relatedArtistNames = async () => ['Close Artist'];
    dispatcher.chooseFrom = (tracks, affinity) => {
        seen = { tracks, affinity };
        return makeSong('picked', { author: 'Seed Artist', uri: 'https://x/picked' });
    };

    const original = Math.random;
    Math.random = () => 0.99;
    let picked;
    try {
        picked = await dispatcher.pickForSeed(seed);
    } finally {
        Math.random = original;
    }

    assert.equal(picked?.info.title, 'picked');
    assert.equal(seen.tracks.length, 1);
    assert.equal(seen.affinity.seedArtist, 'Seed Artist');
    assert.deepEqual(seen.affinity.relatedArtists, ['Close Artist']);
});

test('the same seed reuses its mix instead of resolving it on every pick', async () => {
    const dispatcher = makeDispatcher();
    const seed = makeSong('seed', { uri: 'https://x/mix-seed' });
    let calls = 0;
    dispatcher.youtubeIdFor = async () => 'abcdefghijk';
    dispatcher.node = {
        rest: {
            resolve: async () => {
                calls += 1;
                return {
                    loadType: 'playlist',
                    data: { tracks: [candidate('mix', 'Seed Artist', 'https://x/mix')] },
                };
            },
        },
    };

    const first = await dispatcher.relatedTracks(seed);
    const second = await dispatcher.relatedTracks(seed);

    assert.equal(calls, 1);
    assert.equal(first.length, 1);
    assert.equal(second, first);
});


test('the current track is rejected even when the mix uses another source', () => {
    const dispatcher = makeDispatcher();
    dispatcher.current = makeSong('Hate Myself', {
        author: 'NF',
        uri: 'https://deezer.com/track/716493422',
    });
    const sameSongOnYouTube = candidate(
        'Hate Myself',
        'NF',
        'https://www.youtube.com/watch?v=6io0g7WuHaI'
    );

    assert.equal(dispatcher.chooseFrom([sameSongOnYouTube]), null);
});

test('explicit requests form a newest-first seed pool capped at three', () => {
    const dispatcher = makeDispatcher();
    for (const [title, uri] of [
        ['one', 'https://x/one'],
        ['two', 'https://x/two'],
        ['three', 'https://x/three'],
        ['four', 'https://x/four'],
    ]) {
        dispatcher.enqueue(makeSong(title, { author: 'Artist', uri }));
    }

    assert.deepEqual(
        dispatcher.seeds.map(seed => seed.info.title),
        ['four', 'three', 'two']
    );
    assert.equal(dispatcher.seed?.info.title, 'four');
});

test('a comma-separated /autoplay seeds every lane and queues the first pick', async () => {
    const dispatcher = makeDispatcher();
    dispatcher.pickFromQuery = async query =>
        makeSong(query, { author: query, uri: `https://x/${encodeURIComponent(query)}` });

    const opener = await dispatcher.seedFrom('NF, Hotel Books');

    assert.equal(opener?.info.title, 'NF');
    assert.deepEqual(
        dispatcher.seeds.map(seed => seed.info.title),
        ['NF', 'Hotel Books']
    );
    assert.deepEqual(dispatcher.queue.map(track => track.info.title), ['NF']);
});

test('the newest seed lane is drawn most often', () => {
    const dispatcher = makeDispatcher({
        seeds: [
            makeSong('newest', { author: 'A', uri: 'https://x/n' }),
            makeSong('middle', { author: 'B', uri: 'https://x/m' }),
            makeSong('oldest', { author: 'C', uri: 'https://x/o' }),
        ],
    });
    const original = Math.random;
    Math.random = () => 0;
    try {
        assert.equal(dispatcher.seedCandidates()[0]?.info.title, 'newest');
    } finally {
        Math.random = original;
    }
});

test('a restored user request is eligible when no seed pool was persisted', () => {
    const dispatcher = makeDispatcher({
        current: makeSong('restored', { author: 'User Artist', uri: 'https://x/restored' }),
    });

    assert.equal(dispatcher.seedCandidates()[0]?.info.title, 'restored');
});

test('playlist seeds favor distinct artists and never duplicate a track', () => {
    const dispatcher = makeDispatcher();
    const playlist = [
        makeSong('a1', { author: 'Artist A', uri: 'https://x/a1' }),
        makeSong('a2', { author: 'Artist A', uri: 'https://x/a2' }),
        makeSong('a3', { author: 'Artist A', uri: 'https://x/a3' }),
        makeSong('b1', { author: 'Artist B', uri: 'https://x/b1' }),
        makeSong('c1', { author: 'Artist C', uri: 'https://x/c1' }),
        makeSong('c1-copy', { author: 'Artist C', uri: 'https://x/c1' }),
        makeSong('c1', { author: 'Artist C', uri: 'https://x/c1-different-uri' }),
    ];

    dispatcher.seedPlaylist(playlist);

    assert.equal(dispatcher.seeds.length, 3);
    assert.equal(new Set(dispatcher.seeds.map(track => track.info.author)).size, 3);
    assert.equal(new Set(dispatcher.seeds.map(track => track.info.uri)).size, 3);
});

test('enqueue can defer seed recording while a playlist is collected', () => {
    const dispatcher = makeDispatcher();
    dispatcher.enqueue(makeSong('one', { author: 'A', uri: 'https://x/one' }), false);
    assert.equal(dispatcher.seeds.length, 0);

    dispatcher.enqueue(makeSong('two', { author: 'B', uri: 'https://x/two' }));
    assert.deepEqual(dispatcher.seeds.map(track => track.info.title), ['two']);
});

test('a seed-only mix occasionally hops to a related artist', async () => {
    const seed = makeSong('seed', { author: 'Seed Artist', uri: 'https://x/seed' });
    const dispatcher = makeDispatcher({ seed });
    const mix = [candidate('next', 'Seed Artist', 'https://x/next')];
    dispatcher.relatedTracks = async () => mix;
    dispatcher.relatedArtistNames = async () => ['Close Artist'];
    dispatcher.pickFromQuery = async name =>
        makeSong(name, { author: name, uri: `https://x/${encodeURIComponent(name)}` });

    const original = Math.random;
    Math.random = () => 0;
    try {
        const picked = await dispatcher.pickForSeed(seed);
        assert.equal(picked?.info.author, 'Close Artist');
    } finally {
        Math.random = original;
    }
});
