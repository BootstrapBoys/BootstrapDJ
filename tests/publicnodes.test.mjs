import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    FALLBACK_PREFIX,
    isFallbackNode,
    parsePublicNodes,
    rankNodes,
    scoreNode,
    shouldFallback,
    toNodeOption,
} from '../dist/lib/PublicNodes.js';

test('parsePublicNodes keeps only usable v4 entries', () => {
    const nodes = parsePublicNodes([
        {
            identifier: 'a',
            host: '  lava.example.com ',
            port: 2333,
            password: 'p',
            secure: false,
            version: 'v4',
        },
        { host: 'v3.example.com', port: 2333, password: 'p', secure: false, version: 'v3' },
        { host: '', port: 2333, version: 'v4' },
        { host: 'bad-port.example.com', port: 'x', version: 'v4' },
        { host: 'no-id.example.com', port: 443, secure: true, version: 'v4' },
        { identifier: 'nodelink-x', host: 'nl.example.com', port: 443, version: 'v4' },
        { identifier: 'plain', host: 'nodelink.example.com', port: 443, version: 'v4' },
        'not-an-object',
    ]);

    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].host, 'lava.example.com');
    assert.equal(nodes[1].identifier, 'no-id.example.com-443');
    assert.equal(nodes[1].secure, true);
    assert.equal(nodes[1].password, '');
});

test('toNodeOption builds a prefixed Shoukaku option', () => {
    const option = toNodeOption({
        identifier: 'eu-1',
        host: 'lava.example.com',
        port: 443,
        password: 'secret',
        secure: true,
        version: 'v4',
    });

    assert.equal(option.name, `${FALLBACK_PREFIX}eu-1`);
    assert.equal(option.url, 'lava.example.com:443');
    assert.equal(option.auth, 'secret');
    assert.equal(option.secure, true);
    assert.equal(isFallbackNode(option.name), true);
    assert.equal(isFallbackNode('lava-main'), false);
});

test('ranking prefers low latency and lightly loaded nodes', () => {
    const fastBusy = { entry: { identifier: 'fast-busy' }, latencyMs: 100, players: 50 };
    const slowIdle = { entry: { identifier: 'slow-idle' }, latencyMs: 300, players: 0 };
    const edge = { entry: { identifier: 'edge' }, latencyMs: 400, players: 2 };

    assert.equal(scoreNode(fastBusy), 100 + 50 * 20);
    const ranked = rankNodes([fastBusy, slowIdle, edge]);

    assert.deepEqual(
        ranked.map(node => node.entry.identifier),
        ['slow-idle', 'edge', 'fast-busy']
    );
});

test('shouldFallback only fires after the threshold and without a fallback', () => {
    assert.equal(shouldFallback(60_000, 180, false), false);
    assert.equal(shouldFallback(181_000, 180, false), true);
    assert.equal(shouldFallback(999_999, 180, true), false);
    assert.equal(shouldFallback(999_999, 0, false), false);
});
