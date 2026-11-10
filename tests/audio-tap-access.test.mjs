import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guildAccessFor } from '../dist/dashboard/shardApi.js';

const GUILD = '123456789012345678';
const USER = '223456789012345678';

function makeClient({
    allowAll = 'true',
    roles = '',
    memberRoles = [],
    ownerId = '323456789012345678',
} = {}) {
    const member = {
        permissions: { has: () => false },
        roles: { cache: new Map(memberRoles.map(id => [id, { id }])) },
    };
    const guild = {
        id: GUILD,
        ownerId,
        members: {
            cache: new Map([[USER, member]]),
            fetch: async () => member,
        },
    };
    return {
        guilds: { cache: new Map([[GUILD, guild]]) },
        db: {
            getRoles: async () => [],
            getGuildSettings: async () => ({
                audiotapallowall: allowAll,
                audiotaproles: roles,
            }),
        },
    };
}

test('audio tap allow-all grants a normal member listen access', async () => {
    const result = await guildAccessFor(makeClient(), USER, GUILD);
    assert.equal(result.found, true);
    assert.equal(result.access.listen, true);
});

test('audio tap deny-all grants only owners and admins', async () => {
    const result = await guildAccessFor(makeClient({ allowAll: 'false', roles: '' }), USER, GUILD);
    assert.equal(result.access.listen, false);
});

test('audio tap role allowlist grants a matching role', async () => {
    const result = await guildAccessFor(
        makeClient({
            allowAll: 'false',
            roles: '423456789012345678, 523456789012345678',
            memberRoles: ['523456789012345678'],
        }),
        USER,
        GUILD
    );
    assert.equal(result.access.listen, true);
});

test('audio tap owners bypass the role allowlist', async () => {
    const result = await guildAccessFor(
        makeClient({ allowAll: 'false', ownerId: USER }),
        USER,
        GUILD
    );
    assert.equal(result.access.listen, true);
});

test('token mode keeps full access including listen', async () => {
    const result = await guildAccessFor(makeClient(), null, GUILD);
    assert.equal(result.access.listen, true);
});
