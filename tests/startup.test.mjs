import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { startClientOrExit, startOrExit } from '../dist/lib/Startup.js';

test('a rejected startup exits non-zero instead of becoming a zombie', async () => {
    const exits = [];
    const logs = [];
    const client = {
        start: async () => {
            throw new Error('invalid token');
        },
        logger: {
            error: (...args) => logs.push(args),
        },
    };

    await startClientOrExit(client, 'bad-token', code => exits.push(code));

    assert.deepEqual(exits, [1]);
    assert.equal(logs.length, 1);
    assert.match(String(logs[0][0]), /startup failed/);
});

test('a successful startup leaves the process running', async () => {
    const exits = [];
    const tokens = [];
    const client = {
        start: async token => {
            tokens.push(token);
        },
        logger: { error: () => {} },
    };

    await startClientOrExit(client, 'the-token', code => exits.push(code));

    assert.deepEqual(tokens, ['the-token']);
    assert.deepEqual(exits, []);
});

test('the real exit path terminates the process with status 1', () => {
    const script = `
        import { startOrExit } from './dist/lib/Startup.js';
        await startOrExit(async () => { throw new Error('invalid token'); }, () => {});
        console.log('still alive');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /still alive/);
});
