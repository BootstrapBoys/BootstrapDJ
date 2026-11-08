import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveSearchEngine } from '../dist/lib/SearchEngine.js';

const client = {
    config: { searchEngine: 'dzsearch', prefixSearchEngine: 'ytsearch' },
    db: { getGuildSettings: async () => ({ searchtype: 'ytmsearch' }) },
};

test('prefix searches use the prefix engine without a settings lookup', async () => {
    let calls = 0;
    const probe = {
        ...client,
        db: { getGuildSettings: async () => { calls += 1; return {}; } },
    };
    const engine = await resolveSearchEngine(probe, { isInteraction: false, guild: { id: 'g' } });
    assert.equal(engine, 'ytsearch');
    assert.equal(calls, 0);
});

test('slash searches use guild searchtype then the default engine', async () => {
    const configured = await resolveSearchEngine(client, { isInteraction: true, guild: { id: 'g' } });
    assert.equal(configured, 'ytmsearch');

    const fallback = await resolveSearchEngine(
        { ...client, db: { getGuildSettings: async () => ({}) } },
        { isInteraction: true, guild: { id: 'g' } }
    );
    assert.equal(fallback, 'dzsearch');
});
