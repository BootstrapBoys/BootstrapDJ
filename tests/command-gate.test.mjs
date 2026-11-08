import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

import Command from '../dist/core/Command.js';
import { evaluateCommand } from '../dist/lib/CommandGate.js';

function makeCommand(overrides = {}) {
    return new Command(
        { config: {} },
        {
            name: 'test',
            description: { content: 'test', usage: 'test', examples: ['test <song>'] },
            category: 'general',
            cooldown: 0.001,
            player: { voice: true, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            ...overrides,
        }
    );
}

function makeMember({ id = 'member', denied = [], voice = { id: 'member-vc', type: ChannelType.GuildVoice }, roles = [] } = {}) {
    return {
        id,
        roleIds: roles,
        hasPermission: permission => !denied.includes(permission),
        voiceChannel: voice,
    };
}

function makeClient(overrides = {}) {
    return {
        preferredBotStatus: async () => ({ allowed: true, name: null }),
        db: {
            isCommandAllowed: async () => true,
            getDj: async () => null,
            getRoles: async () => [],
        },
        queue: new Map(),
        cooldown: new Map(),
        config: { owners: ['dev'] },
        embed: () => new EmbedBuilder(),
        color: { red: 0xff0000 },
        ...overrides,
    };
}

function makeInput(overrides = {}) {
    const command = overrides.command ?? makeCommand();
    return {
        client: makeClient(),
        command,
        guildId: 'guild',
        guildName: 'Guild',
        member: makeMember(),
        me: makeMember({ voice: null }),
        channel: { id: 'channel', isThread: () => false },
        canViewChannel: true,
        settings: {},
        args: ['song'],
        commandKey: command.name,
        isPrefix: true,
        ...overrides,
    };
}

test('gate allows a valid command', async () => {
    assert.deepEqual(await evaluateCommand(makeInput()), { ok: true });
});

test('gate routes voice commands to the preferred bot', async () => {
    const client = makeClient({
        preferredBotStatus: async () => ({ allowed: false, name: 'CommunityManager2' }),
    });
    const result = await evaluateCommand(makeInput({ client }));
    assert.equal(result.ok, false);
    assert.match(result.response.content, /CommunityManager2/);
});

test('gate respects locked sessions but lets managers unlock', async () => {
    const locked = await evaluateCommand(
        makeInput({
            settings: { locked: 'true' },
            member: makeMember({ denied: [PermissionFlagsBits.ManageGuild] }),
        })
    );
    assert.equal(locked.ok, false);
    assert.match(locked.response.content, /locked/);

    const manager = makeMember({ denied: [] });
    manager.hasPermission = permission =>
        permission === PermissionFlagsBits.ManageGuild || permission === 'SendMessages' || permission === 'ViewChannel' || permission === 'EmbedLinks';
    const allowed = await evaluateCommand(makeInput({ settings: { locked: 'true' }, member: manager }));
    assert.deepEqual(allowed, { ok: true });
});

test('gate honors command permissions, threads, disabled commands and channels', async () => {
    const client = makeClient({ db: { ...makeClient().db, isCommandAllowed: async () => false } });
    assert.equal((await evaluateCommand(makeInput({ client }))).ok, false);

    const thread = await evaluateCommand(
        makeInput({
            settings: { allowthreads: 'false' },
            channel: { id: 'channel', isThread: () => true },
        })
    );
    assert.match(thread.response.content, /threads/);

    const disabled = await evaluateCommand(makeInput({ settings: { disabledcommands: 'test' } }));
    assert.match(disabled.response.content, /disabled/);

    const wrongChannel = await evaluateCommand(
        makeInput({ settings: { commandchannel: 'other' } })
    );
    assert.match(wrongChannel.response.content, /restricted/);

    const wrongVoice = await evaluateCommand(
        makeInput({ settings: { voicechannel: 'other' } })
    );
    assert.match(wrongVoice.response.content, /must be in/);
});

test('gate silently drops an invisible channel and DMs on missing SendMessages', async () => {
    const invisible = await evaluateCommand(makeInput({ canViewChannel: false }));
    assert.deepEqual(invisible, { ok: false, silent: true });

    const me = makeMember({ denied: [PermissionFlagsBits.SendMessages], voice: null });
    const dm = await evaluateCommand(makeInput({ me }));
    assert.equal(dm.ok, false);
    assert.equal(dm.dm, true);
    assert.match(dm.response.content, /SendMessage/);
});

test('gate checks bot, user and developer permissions', async () => {
    const noEmbed = makeMember({ denied: [PermissionFlagsBits.EmbedLinks] });
    assert.match((await evaluateCommand(makeInput({ me: noEmbed }))).response.content, /EmbedLinks/);

    const noClientPermission = makeMember({ denied: ['ViewChannel'] });
    assert.match(
        (await evaluateCommand(makeInput({ me: noClientPermission }))).response.content,
        /enough permissions/
    );

    const noUserPermission = makeCommand({
        permissions: { dev: false, client: [], user: ['ManageGuild'] },
    });
    const noUser = makeMember({ denied: ['ManageGuild'] });
    assert.match(
        (await evaluateCommand(makeInput({ command: noUserPermission, member: noUser }))).response
            .content,
        /permissions to use/
    );

    const devOnly = makeCommand({
        permissions: { dev: true, client: [], user: [] },
    });
    const devRejected = await evaluateCommand(makeInput({ command: devOnly }));
    assert.deepEqual(devRejected, { ok: false, silent: true });
    const devAllowed = await evaluateCommand(
        makeInput({ command: devOnly, member: makeMember({ id: 'dev', roles: [] }) })
    );
    assert.deepEqual(devAllowed, { ok: true });
});

test('gate enforces voice membership, stage and same-channel rules', async () => {
    const noVoice = makeMember({ voice: null });
    assert.match(
        (await evaluateCommand(makeInput({ member: noVoice }))).response.content,
        /connected to a voice channel/
    );

    const noConnect = makeMember({ denied: [PermissionFlagsBits.Connect] });
    assert.match((await evaluateCommand(makeInput({ me: noConnect }))).response.content, /CONNECT/);

    const noSpeak = makeMember({ denied: [PermissionFlagsBits.Speak] });
    assert.match((await evaluateCommand(makeInput({ me: noSpeak }))).response.content, /SPEAK/);

    const stage = makeMember({
        voice: { id: 'member-vc', type: ChannelType.GuildStageVoice },
    });
    const stageMe = makeMember({
        denied: [PermissionFlagsBits.RequestToSpeak],
        voice: null,
    });
    assert.match(
        (await evaluateCommand(makeInput({ member: stage, me: stageMe }))).response.content,
        /REQUEST TO SPEAK/
    );

    const meOtherVoice = makeMember({ voice: { id: 'other-vc', type: ChannelType.GuildVoice } });
    assert.match(
        (await evaluateCommand(makeInput({ me: meOtherVoice }))).response.content,
        /not connected to/
    );
});

test('gate checks active players and DJ roles', async () => {
    const active = makeCommand({ player: { voice: true, dj: false, active: true, djPerm: null } });
    assert.match(
        (await evaluateCommand(makeInput({ command: active }))).response.content,
        /Nothing is playing/
    );

    const djCommand = makeCommand({ player: { voice: true, dj: true, active: false, djPerm: null } });
    const djClient = makeClient({
        db: {
            ...makeClient().db,
            getDj: async () => ({ mode: true }),
            getRoles: async () => [{ roleId: 'dj-role' }],
        },
    });
    assert.match(
        (
            await evaluateCommand(
                makeInput({
                    command: djCommand,
                    client: djClient,
                    member: makeMember({ denied: [PermissionFlagsBits.ManageGuild] }),
                })
            )
        ).response.content,
        /DJ role/
    );

    const manager = makeMember({ roles: [] });
    manager.hasPermission = permission =>
        permission === PermissionFlagsBits.ManageGuild || permission === 'SendMessages' || permission === 'ViewChannel' || permission === 'EmbedLinks';
    assert.deepEqual(
        await evaluateCommand(makeInput({ command: djCommand, client: djClient, member: manager })),
        { ok: true }
    );
});

test('gate requires prefix arguments but not slash options', async () => {
    const argsCommand = makeCommand({ args: true });
    const prefix = await evaluateCommand(
        makeInput({ command: argsCommand, args: [], isPrefix: true })
    );
    assert.equal(prefix.ok, false);
    assert.equal(prefix.response.embeds[0].data.title, 'Missing Arguments');

    assert.deepEqual(
        await evaluateCommand(makeInput({ command: argsCommand, args: [], isPrefix: false })),
        { ok: true }
    );
});

test('gate enforces cooldown and mention bans', async () => {
    const command = makeCommand({ cooldown: 1 });
    const client = makeClient();
    assert.deepEqual(await evaluateCommand(makeInput({ command, client })), { ok: true });
    const cooled = await evaluateCommand(makeInput({ command, client }));
    assert.equal(cooled.ok, false);
    assert.match(cooled.response.content, /Please wait/);

    const mentions = await evaluateCommand(makeInput({ args: ['@everyone'] }));
    assert.match(mentions.response.content, /mention everyone/);
});
