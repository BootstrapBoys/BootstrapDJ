import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import loadPlugins, { shutdownPlugins } from '../dist/plugin/index.js';

async function pluginDir(plugins) {
    const dir = await mkdtemp(path.join(tmpdir(), 'bootstrapdj-plugins-'));
    for (const [file, body] of Object.entries(plugins)) {
        await writeFile(path.join(dir, file), body);
    }
    return dir;
}

function pluginSource(name, { failShutdown = false } = {}) {
    return `
export default {
    name: ${JSON.stringify(name)},
    version: '1.0.0',
    author: 'test',
    initialize: () => globalThis.__pluginOrder.push('init:${name}'),
    shutdown: () => {
        globalThis.__pluginOrder.push('shutdown:${name}');
        ${failShutdown ? "throw new Error('teardown failed');" : ''}
    },
};
`;
}

function makeClient() {
    const errors = [];
    return {
        client: {
            logger: {
                info: () => {},
                error: (...args) => errors.push(args.map(String).join(' ')),
            },
        },
        errors,
    };
}

test('plugins initialize in file order and shut down in reverse exactly once', async () => {
    globalThis.__pluginOrder = [];
    const dir = await pluginDir({
        'a-first.js': pluginSource('first'),
        'b-second.js': pluginSource('second'),
    });
    const { client } = makeClient();

    try {
        await loadPlugins(client, dir);
        assert.deepEqual(globalThis.__pluginOrder, ['init:first', 'init:second']);

        await shutdownPlugins(client);
        assert.deepEqual(globalThis.__pluginOrder, [
            'init:first',
            'init:second',
            'shutdown:second',
            'shutdown:first',
        ]);

        await shutdownPlugins(client);
        assert.equal(globalThis.__pluginOrder.length, 4, 'a second shutdown must be a no-op');
    } finally {
        delete globalThis.__pluginOrder;
        await rm(dir, { recursive: true, force: true });
    }
});

test('a failing plugin shutdown does not strand the plugins behind it', async () => {
    globalThis.__pluginOrder = [];
    const dir = await pluginDir({
        'a-first.js': pluginSource('first'),
        'b-second.js': pluginSource('second'),
        'c-broken.js': pluginSource('broken', { failShutdown: true }),
    });
    const { client, errors } = makeClient();

    try {
        await loadPlugins(client, dir);
        await shutdownPlugins(client);

        // Reverse order: broken fails, second and first still run.
        assert.deepEqual(globalThis.__pluginOrder, [
            'init:first',
            'init:second',
            'init:broken',
            'shutdown:broken',
            'shutdown:second',
            'shutdown:first',
        ]);
        assert.match(errors.join('\n'), /broken.*teardown failed/);
    } finally {
        delete globalThis.__pluginOrder;
        await rm(dir, { recursive: true, force: true });
    }
});
