import assert from 'node:assert/strict';
import { test } from 'node:test';

import PlayLocal from '../dist/commands/music/PlayLocal.js';

function fakeClient() {
    return {
        config: {},
        logger: {},
        queue: { get: () => undefined },
        embed: () => ({
            setColor() {
                return this;
            },
            setDescription() {
                return this;
            },
        }),
        color: { red: 0xff0000 },
    };
}

function fakeContext(attachment) {
    const replies = [];
    return {
        replies,
        ctx: {
            guild: { id: 'g1', channels: { cache: { get: () => null } } },
            voiceChannel: null,
            channelId: 'c1',
            isInteraction: true,
            interaction: { options: { getAttachment: () => attachment } },
            sendMessage: async payload => {
                replies.push(payload);
                return payload;
            },
        },
    };
}

test('playlocal uses an attachment file option and defers', () => {
    const command = new PlayLocal(fakeClient());
    assert.equal(command.defer, true);
    assert.equal(command.options[0].name, 'file');
    assert.equal(command.options[0].type, 11);
    assert.equal(command.options[0].required, true);
});

test('playlocal rejects a missing attachment', async () => {
    const client = fakeClient();
    const harness = fakeContext(undefined);
    await new PlayLocal(client).run(client, harness.ctx, []);
    assert.equal(harness.replies.length, 1);
});

test('playlocal rejects a non-audio attachment', async () => {
    const client = fakeClient();
    const harness = fakeContext({
        contentType: 'text/plain',
        size: 10,
        url: 'https://example.test/file.txt',
    });
    await new PlayLocal(client).run(client, harness.ctx, []);
    assert.equal(harness.replies.length, 1);
});
