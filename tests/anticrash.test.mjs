import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(repo, 'dist/plugin/plugins/antiCrash.js');

/** Runs the real plugin in a child process and reports how that process ended. */
function runPlugin(body) {
    const source = `
import { pathToFileURL } from 'node:url';
const { default: plugin } = await import(pathToFileURL(process.argv[1]).href);
const client = {
    logger: {
        error: (...args) => console.error('LOGGED:', args.map(String).join(' ')),
        star: () => {}, success: () => {}, info: () => {}, warn: () => {}, debug: () => {},
    },
    destroy: async () => {},
};
plugin.initialize(client);
${body}
`;
    return new Promise(resolve => {
        execFile(
            process.execPath,
            ['--input-type=module', '-e', source, plugin],
            { cwd: repo, timeout: 15000 },
            (error, stdout, stderr) =>
                resolve({
                    code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
                    stdout,
                    stderr,
                })
        );
    });
}

test('an uncaught exception is logged and the process exits non-zero', async () => {
    const result = await runPlugin(
        "process.emit('uncaughtException', new Error('boom-test'));\nconsole.log('STILL_ALIVE');"
    );

    assert.equal(result.code, 1, 'process must exit so pm2 can restart it');
    assert.ok(!result.stdout.includes('STILL_ALIVE'), 'execution must stop at the handler');
    assert.match(result.stderr, /Uncaught Exception/);
    assert.match(result.stderr, /boom-test/);
});

test('an unhandled rejection is logged but the process keeps running', async () => {
    const result = await runPlugin(
        "process.emit('unhandledRejection', new Error('reject-test'), Promise.resolve());\nconsole.log('STILL_ALIVE');"
    );

    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('STILL_ALIVE'), 'a rejected promise must not kill the bot');
    assert.match(result.stderr, /Unhandled Rejection/);
    assert.match(result.stderr, /reject-test/);
});
