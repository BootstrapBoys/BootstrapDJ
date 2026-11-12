import assert from 'node:assert/strict';
import test from 'node:test';

import { AutocompleteInteraction, InteractionType } from 'discord.js';

import InteractionCreate from '../dist/events/client/InteractionCreate.js';

function makeInteraction({ commandName, optionName, value = 'x', getString = null }) {
    const responses = [];
    const interaction = Object.create(AutocompleteInteraction.prototype);
    interaction.type = InteractionType.ApplicationCommandAutocomplete;
    interaction.commandName = commandName;
    interaction.user = { id: 'user-1' };
    interaction.options = {
        getFocused: () => ({ name: optionName, value }),
        getString: () => getString,
    };
    interaction.respond = async choices => {
        responses.push(choices);
    };
    return { interaction, responses };
}

function makeEvent(overrides = {}) {
    const errors = [];
    const client = {
        logger: {
            error: (...args) => errors.push(args.map(String).join(' ')),
            warn: () => {},
            info: () => {},
            debug: () => {},
        },
        config: { owners: [] },
        guilds: { cache: new Map() },
        commands: new Map(),
        db: {
            getPlaylists: async () => {
                throw new Error('database unavailable');
            },
        },
        queue: {
            search: async () => {
                throw new Error('Lavalink unavailable');
            },
        },
        ...overrides,
    };
    return { event: new InteractionCreate(client, 'events/client/InteractionCreate.ts'), errors };
}

function fakeCommand(name, { category = 'music', dev = false } = {}) {
    return { name, category, permissions: { dev } };
}

function commandMap(...commands) {
    return new Map(commands.map(command => [command.name, command]));
}

test('a failing playlist lookup still answers autocomplete with an empty list', async () => {
    const { event, errors } = makeEvent();
    const { interaction, responses } = makeInteraction({
        commandName: 'playlist',
        optionName: 'name',
    });

    await event.run(interaction);

    assert.deepEqual(responses, [[]]);
    assert.match(errors.join('\n'), /database unavailable/);
});

test('a failing track search still answers autocomplete with an empty list', async () => {
    const { event, errors } = makeEvent();
    const { interaction, responses } = makeInteraction({
        commandName: 'play',
        optionName: 'song',
        getString: 'query',
    });

    await event.run(interaction);

    assert.deepEqual(responses, [[]]);
    assert.match(errors.join('\n'), /Lavalink unavailable/);
});

test('an unknown autocomplete command answers empty without an error', async () => {
    const { event, errors } = makeEvent();
    const { interaction, responses } = makeInteraction({
        commandName: 'about',
        optionName: 'query',
    });

    await event.run(interaction);

    assert.deepEqual(responses, [[]]);
    assert.deepEqual(errors, []);
});

test('help autocomplete suggests canonical commands for a typed prefix', async () => {
    const { event, errors } = makeEvent({
        commands: commandMap(
            fakeCommand('play'),
            fakeCommand('playnext'),
            fakeCommand('pause'),
            fakeCommand('queue')
        ),
    });
    const { interaction, responses } = makeInteraction({
        commandName: 'help',
        optionName: 'command',
        value: 'pl',
    });

    await event.run(interaction);

    assert.deepEqual(
        responses[0].map(choice => choice.value),
        ['play', 'playnext']
    );
    assert.deepEqual(errors, []);
});

test('help autocomplete hides developer commands from non-owners', async () => {
    const commands = commandMap(
        fakeCommand('play'),
        fakeCommand('eval', { category: 'dev', dev: true }),
        fakeCommand('guildlist', { category: 'dev', dev: true })
    );
    const { event } = makeEvent({ commands });
    const { interaction, responses } = makeInteraction({
        commandName: 'help',
        optionName: 'command',
        value: '',
    });

    await event.run(interaction);

    const values = responses[0].map(choice => choice.value);
    assert.ok(values.includes('play'));
    assert.ok(!values.includes('eval'));
    assert.ok(!values.includes('guildlist'));
});

test('help autocomplete shows developer commands to owners', async () => {
    const commands = commandMap(
        fakeCommand('play'),
        fakeCommand('eval', { category: 'dev', dev: true })
    );
    const { event } = makeEvent({ commands, config: { owners: ['user-1'] } });
    const { interaction, responses } = makeInteraction({
        commandName: 'help',
        optionName: 'command',
        value: 'ev',
    });

    await event.run(interaction);

    assert.deepEqual(
        responses[0].map(choice => choice.value),
        ['eval']
    );
});

test('help autocomplete caps the answer at 25 choices', async () => {
    const commands = commandMap(
        ...Array.from({ length: 40 }, (_, index) => fakeCommand(`query${index}`))
    );
    const { event } = makeEvent({ commands });
    const { interaction, responses } = makeInteraction({
        commandName: 'help',
        optionName: 'command',
        value: 'query',
    });

    await event.run(interaction);

    assert.equal(responses[0].length, 25);
});

test('help autocomplete answers empty for a query that matches nothing', async () => {
    const { event, errors } = makeEvent({ commands: commandMap(fakeCommand('play')) });
    const { interaction, responses } = makeInteraction({
        commandName: 'help',
        optionName: 'command',
        value: 'zzz',
    });

    await event.run(interaction);

    assert.deepEqual(responses, [[]]);
    assert.deepEqual(errors, []);
});
