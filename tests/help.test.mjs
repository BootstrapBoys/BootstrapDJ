import assert from 'node:assert/strict';
import test from 'node:test';

import { EmbedBuilder } from 'discord.js';

import Command from '../dist/core/Command.js';
import Help from '../dist/commands/tools/Help.js';

function makeClient(overrides = {}) {
    return {
        config: { owners: [], prefix: '!' },
        color: { main: 0x2f3136, red: 0xff0000 },
        embed: () => new EmbedBuilder(),
        user: { username: 'BootstrapDJ' },
        commands: new Map(),
        aliases: new Map(),
        db: { get: async () => ({ prefix: '!' }) },
        ...overrides,
    };
}

function makeContext(locale, authorId = 'user-1') {
    return {
        locale,
        author: { id: authorId },
        guild: { id: 'guild-1' },
        sendMessage: async payload => payload,
    };
}

function playCommand(client) {
    return new Command(client, {
        name: 'play',
        description: {
            content: 'Plays a song from YouTube or Spotify',
            usage: 'play <song>',
            examples: ['play never gonna give you up'],
        },
        category: 'music',
        aliases: ['p'],
        cooldown: 5,
        player: { voice: true, dj: false, active: false, djPerm: null },
        permissions: {
            dev: false,
            client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
            user: ['Connect'],
        },
    });
}

function devCommand(client) {
    return new Command(client, {
        name: 'eval',
        description: { content: 'Evaluate code', usage: 'eval <code>', examples: ['eval 1 + 1'] },
        category: 'dev',
        permissions: { dev: true, client: ['SendMessages'], user: [] },
    });
}

test('German details show the localized description and hide internals', () => {
    const client = makeClient();
    const help = new Help(client);
    const embed = help.details(client, makeContext('de'), playCommand(client), '!');
    const description = embed.data.description ?? '';

    assert.match(description, /Spielt einen Song von YouTube oder Spotify/);
    assert.ok(!description.includes('Plays a song from YouTube or Spotify'));
    assert.match(description, /Sprache/);
    assert.ok(!description.includes('Bot-Berechtigungen'));
    assert.ok(!description.includes('Nur Entwickler'));
    assert.ok(!description.includes('Kategorie'));
    assert.ok(!description.includes('Argumente'));
    assert.ok(!description.includes('Slash-Befehl'));
});

test('a command without catalog metadata falls back to its constructor description', () => {
    const client = makeClient();
    const help = new Help(client);
    const command = new Command(client, {
        name: 'not-a-real-command',
        description: { content: 'Fallback copy', usage: 'fallback', examples: ['fallback'] },
        category: 'general',
    });
    const embed = help.details(client, makeContext('de'), command, '!');

    assert.match(embed.data.description ?? '', /Fallback copy/);
});

test('run resolves aliases to the canonical command', async () => {
    const client = makeClient();
    const help = new Help(client);
    client.commands.set('help', help);
    client.aliases.set('h', 'help');

    const payload = await help.run(client, makeContext('de'), ['h']);

    assert.match(payload.embeds[0].data.title ?? '', /Hilfemenü - help/);
    assert.match(payload.embeds[0].data.description ?? '', /Zeigt das Hilfemenü/);
});

test('run refuses developer commands to non-owners', async () => {
    const client = makeClient();
    const help = new Help(client);
    client.commands.set('help', help);
    client.commands.set('eval', devCommand(client));

    const payload = await help.run(client, makeContext('de'), ['eval']);

    assert.match(payload.embeds[0].data.description ?? '', /Befehl `eval` nicht gefunden/);
});

test('run describes developer commands to owners and marks them developer-only', async () => {
    const client = makeClient({ config: { owners: ['owner-1'], prefix: '!' } });
    const help = new Help(client);
    client.commands.set('help', help);
    client.commands.set('eval', devCommand(client));

    const payload = await help.run(client, makeContext('de', 'owner-1'), ['eval']);

    assert.match(payload.embeds[0].data.description ?? '', /Führt Code aus/);
    assert.match(payload.embeds[0].data.description ?? '', /Nur Entwickler/);
});

test('English details keep the English catalog copy', () => {
    const client = makeClient();
    const help = new Help(client);
    const embed = help.details(client, makeContext('en-US'), playCommand(client), '!');
    const description = embed.data.description ?? '';

    assert.match(description, /Plays a song from YouTube or Spotify/);
    assert.ok(!description.includes('Bot Permissions'));
    assert.ok(!description.includes('Developer Only'));
});
