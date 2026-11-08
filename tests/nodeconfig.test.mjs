import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodePriority, parseFallbackNodes, toNodeOptions } from '../dist/lib/NodeConfig.js';

test('LAVALINK_FALLBACKS parses a JSON array of nodes', () => {
    const nodes = parseFallbackNodes(
        JSON.stringify([
            { name: 'eu-1', url: 'lava.eu:443', auth: 'pw', secure: true },
            { url: 'lava.us:2333' },
            { name: 'missing-url' },
        ])
    );

    assert.equal(nodes.length, 2);
    assert.deepEqual(nodes[0], { name: 'eu-1', url: 'lava.eu:443', auth: 'pw', secure: true });
    assert.equal(nodes[1].name, 'fallback-2');
    assert.equal(nodes[1].secure, false);
    assert.equal(nodes[1].auth, '');
});

test('malformed fallback lists are ignored rather than throwing', () => {
    assert.deepEqual(parseFallbackNodes(undefined), []);
    assert.deepEqual(parseFallbackNodes(''), []);
    assert.deepEqual(parseFallbackNodes('not json'), []);
    assert.deepEqual(parseFallbackNodes('{"url":"x"}'), []);
});

test('toNodeOptions keeps the primary first and fallbacks in order', () => {
    const options = toNodeOptions({ name: 'main', url: 'main:443', auth: 'a', secure: true }, [
        { name: 'eu-1', url: 'eu:443', auth: 'b', secure: true },
        { name: 'us-1', url: 'us:2333', auth: 'c', secure: false },
    ]);

    assert.deepEqual(
        options.map(node => node.name),
        ['main', 'eu-1', 'us-1']
    );
    assert.deepEqual(toNodeOptions(null, []), []);
});

test('configured nodes outrank public nodes', () => {
    const configured = ['main', 'eu-1'];

    assert.equal(nodePriority('main', configured), 0);
    assert.equal(nodePriority('eu-1', configured), 1);
    assert.equal(nodePriority('public-anything', configured), 1000);
    assert.equal(nodePriority('unknown-node', configured), 1001);
});
