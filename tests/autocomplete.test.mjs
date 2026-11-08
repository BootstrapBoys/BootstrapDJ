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
