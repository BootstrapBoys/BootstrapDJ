import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApplicationCommandOptionType, ChannelType } from 'discord.js';

import Command from '../dist/core/Command.js';
import { applyCommandMetadata, toApiOptions } from '../dist/lib/commandMetadata.js';
import { buildCommandBody } from '../dist/lib/CommandManager.js';

// Command constructors only store their client; run() is what reads config.
const fakeClient = { config: {}, logger: {} };

const localeSamples = ['de', 'fr', 'ja'];

function optionNamed(command, name) {
    const option = command.options.find(candidate => candidate.name === name);
    assert.ok(option, `missing option ${name}`);
    return option;
}

test('filter subcommands reach every locale', async () => {
    const Filter = (await import('../dist/commands/filters/Filter.js')).default;
    const command = new Filter(fakeClient);
    applyCommandMetadata(command);

    for (const name of ['8d', 'bassboost', 'pitch']) {
        const option = optionNamed(command, name);
        assert.ok(option.descriptionLocalizations, `${name} must carry localizations`);
        assert.equal(Object.keys(option.descriptionLocalizations).length, 16);
        for (const locale of localeSamples) {
            assert.ok(option.descriptionLocalizations[locale], `${name} is missing ${locale}`);
            assert.notEqual(
                option.descriptionLocalizations[locale],
                option.description,
                `${name}.${locale} must differ from English`
            );
        }
    }

    // A nested option without a catalog entry keeps its constructor fallback.
    const value = optionNamed(command, 'pitch').options[0];
    assert.equal(value.name, 'value');
    assert.equal(value.description, 'Effect value');
    assert.equal(value.descriptionLocalizations, undefined);
});

test('setup subcommands are localized', async () => {
    const Setup = (await import('../dist/commands/manage/Setup.js')).default;
    const command = new Setup(fakeClient);
    applyCommandMetadata(command);

    for (const name of ['create', 'delete', 'info']) {
        const option = optionNamed(command, name);
        assert.ok(option.descriptionLocalizations, `${name} must carry localizations`);
        for (const locale of localeSamples) {
            assert.ok(option.descriptionLocalizations[locale], `${name} is missing ${locale}`);
            assert.notEqual(option.descriptionLocalizations[locale], option.description);
        }
    }
});

test('the serialized body uses snake_case localization keys only', async () => {
    const Filter = (await import('../dist/commands/filters/Filter.js')).default;
    const command = new Filter(fakeClient);
    applyCommandMetadata(command);

    const body = buildCommandBody(command);
    const serialized = JSON.stringify(body);
    assert.match(serialized, /"description_localizations"/);
    assert.doesNotMatch(serialized, /descriptionLocalizations/);
    assert.doesNotMatch(serialized, /nameLocalizations/);
    assert.ok(body.description_localizations.de);
    const eightD = body.options.find(option => option.name === '8d');
    assert.ok(eightD.description_localizations.de);
    assert.equal(eightD.descriptionLocalizations, undefined);
});

test('toApiOptions recurses into subcommands and localizes choices', () => {
    const command = new Command(fakeClient, {
        name: 'synthetic',
        description: { content: 'Synthetic', usage: 'synthetic' },
        options: [
            {
                name: 'group',
                description: 'Group',
                type: ApplicationCommandOptionType.SubcommandGroup,
                options: [
                    {
                        name: 'sub',
                        description: 'Sub',
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: 'pick',
                                description: 'Pick',
                                type: ApplicationCommandOptionType.String,
                                choices: [
                                    {
                                        name: 'One',
                                        value: 'one',
                                        nameLocalizations: { de: 'Eins' },
                                    },
                                ],
                            },
                            {
                                name: 'channel',
                                description: 'Channel',
                                type: ApplicationCommandOptionType.Channel,
                                channelTypes: [ChannelType.GuildVoice],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    const [group] = toApiOptions(command.options);
    assert.equal(group.type, ApplicationCommandOptionType.SubcommandGroup);
    const [sub] = group.options;
    assert.equal(sub.name, 'sub');

    const pick = sub.options.find(option => option.name === 'pick');
    assert.equal(pick.choices[0].name, 'One');
    assert.equal(pick.choices[0].value, 'one');
    assert.equal(pick.choices[0].name_localizations.de, 'Eins');
    assert.equal(pick.choices[0].nameLocalizations, undefined);

    const channel = sub.options.find(option => option.name === 'channel');
    assert.deepEqual(channel.channel_types, [ChannelType.GuildVoice]);
    assert.equal(channel.channelTypes, undefined);

    const serialized = JSON.stringify(toApiOptions(command.options));
    assert.doesNotMatch(serialized, /nameLocalizations/);
    assert.doesNotMatch(serialized, /channelTypes/);
});

test('toApiOptions renames length limits and drops camelCase keys', () => {
    const command = new Command(fakeClient, {
        name: 'limits',
        description: { content: 'Limits', usage: 'limits' },
        options: [
            {
                name: 'text',
                description: 'Text',
                type: ApplicationCommandOptionType.String,
                minLength: 2,
                maxLength: 40,
            },
            {
                name: 'count',
                description: 'Count',
                type: ApplicationCommandOptionType.Integer,
                minValue: 1,
                maxValue: 10,
            },
        ],
    });

    const [text, count] = toApiOptions(command.options);
    assert.equal(text.min_length, 2);
    assert.equal(text.max_length, 40);
    assert.equal(count.min_value, 1);
    assert.equal(count.max_value, 10);
    const serialized = JSON.stringify([text, count]);
    assert.doesNotMatch(serialized, /minLength|maxLength|minValue|maxValue/);
});
