import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldReplyEphemeral } from '../dist/lib/ResponseMode.js';

test('slash replies stay private by default', () => {
    assert.equal(shouldReplyEphemeral(true, {}), true);
    assert.equal(shouldReplyEphemeral(true, { ephemeral: 'true' }), true);
});

test('the guild can opt into normal public slash replies', () => {
    assert.equal(shouldReplyEphemeral(true, { ephemeral: 'false' }), false);
    assert.equal(shouldReplyEphemeral(false, { ephemeral: 'false' }), false);
    assert.equal(shouldReplyEphemeral(false, { ephemeral: 'true' }), false);
});

import { EmbedBuilder } from 'discord.js';
import Utility from '../dist/commands/info/Utility.js';

test('utility exposes a dashboard page and links the configured public URL', async () => {
    const client = {
        config: { dashboardPublicUrl: 'https://dj.example.test/', dashboardOAuthRedirectUri: '' },
        embed: () => new EmbedBuilder(),
        color: { main: 0x2f3136 },
    };
    const command = new Utility(client);
    assert.ok(command.options.some(option => option.name === 'dashboard'));
    let sent;
    const ctx = {
        isInteraction: false,
        guild: { id: 'guild' },
        sendMessage: async payload => {
            sent = payload;
        },
    };
    await command.run(client, ctx, ['dashboard']);
    assert.match(sent.embeds[0].data.description, /https:\/\/dj\.example\.test\//);
});
