import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanLyrics, paginateLyrics } from '../dist/commands/music/Lyrics.js';

test('lyrics cleanup removes LRC timestamps and contributor headers', () => {
    const cleaned = cleanLyrics(
        '[00:01.00] First line\nContributors Lyrics\n\n[00:02.00] Second line'
    );
    assert.equal(cleaned, 'First line\n\nSecond line');
});

test('lyrics pagination respects the page budget', () => {
    const text = Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\n');
    const pages = paginateLyrics(text, 500);
    assert.ok(pages.length > 1);
    assert.ok(pages.every(page => page.length <= 500));
});
