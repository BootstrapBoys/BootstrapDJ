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
