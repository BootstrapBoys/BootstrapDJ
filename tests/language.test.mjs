import assert from 'node:assert/strict';
import { test } from 'node:test';

import Language from '../dist/commands/manage/Language.js';
import { translate } from '../dist/lib/i18n.js';

function fakeClient() {
    const writes = [];
    const embeds = [];
    const client = {
        config: { defaultLanguage: 'en-US' },
        color: { main: 0x2f3136, red: 0xff0000 },
        db: {
            setGuildSetting: async (guildId, key, value) => {
                writes.push({ guildId, key, value });
            },
        },
        embed: () => {
            const embed = {
                setColor() {
                    return this;
                },
                setDescription(description) {
                    embeds.push(description);
                    return this;
                },
            };
            return embed;
        },
    };
    return { client, writes, embeds };
}

function fakeContext() {
    return {
        guild: { id: 'g1' },
        isInteraction: false,
        interaction: null,
        locale: 'en-US',
        setLanguage(language) {
            this.locale = language;
        },
        t(key, variables = {}) {
            return translate(key, this.locale, variables);
        },
        sendMessage: async () => ({}),
    };
}

test('language command persists a supported locale and switches context copy', async () => {
    const { client, writes, embeds } = fakeClient();
    const ctx = fakeContext();
    const command = new Language(client);

    await command.run(client, ctx, ['set', 'en-GB']);

    assert.deepEqual(writes, [{ guildId: 'g1', key: 'language', value: 'en-GB' }]);
    assert.equal(ctx.locale, 'en-GB');
    assert.match(embeds.at(-1), /English \(United Kingdom\)/);
});

test('language command rejects an unsupported locale', async () => {
    const { client, writes, embeds } = fakeClient();
    const ctx = fakeContext();

    await new Language(client).run(client, ctx, ['set', 'fr-FR']);

    assert.deepEqual(writes, []);
    assert.equal(ctx.locale, 'en-US');
    assert.match(embeds.at(-1), /not available/);
});

test('language reset returns to the configured default', async () => {
    const { client, writes, embeds } = fakeClient();
    const ctx = fakeContext();

    await new Language(client).run(client, ctx, ['set', 'en-GB']);
    await new Language(client).run(client, ctx, ['reset']);

    assert.deepEqual(writes.at(-1), { guildId: 'g1', key: 'language', value: 'en-US' });
    assert.equal(ctx.locale, 'en-US');
    assert.match(embeds.at(-1), /English \(United States\)/);
});
