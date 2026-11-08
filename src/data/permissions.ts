import type {
    CommandAlias,
    CommandMapping,
    Dj,
    PermissionRule,
    PrismaClient,
    Role,
} from '../generated/prisma/client.js';

/** Command mappings, aliases, permission rules, and DJ role configuration. */
export class PermissionStore {
    public constructor(protected readonly prisma: PrismaClient) {}

    public async getCommandMapping(
        guildId: string,
        trigger: string,
        userId: string
    ): Promise<CommandMapping | null> {
        const rows = await this.prisma.commandMapping.findMany({
            where: {
                guildId,
                trigger,
                OR: [{ scope: 'server' }, { scope: 'user', userId }],
            },
            take: 2,
        });
        return rows.find(row => row.scope === 'server') ?? rows[0] ?? null;
    }

    public async setCommandMapping(
        guildId: string,
        scope: 'server' | 'user',
        userId: string,
        trigger: string,
        expansion: string
    ): Promise<CommandMapping> {
        return await this.prisma.commandMapping.upsert({
            where: { guildId_scope_userId_trigger: { guildId, scope, userId, trigger } },
            create: { guildId, scope, userId, trigger, expansion },
            update: { expansion },
        });
    }

    public async deleteCommandMapping(
        guildId: string,
        scope: 'server' | 'user',
        userId: string,
        trigger: string
    ): Promise<boolean> {
        const result = await this.prisma.commandMapping.deleteMany({
            where: { guildId, scope, userId, trigger },
        });
        return result.count > 0;
    }

    public async listCommandMappings(guildId: string, userId: string): Promise<CommandMapping[]> {
        return await this.prisma.commandMapping.findMany({
            where: { guildId, OR: [{ scope: 'server' }, { scope: 'user', userId }] },
            orderBy: { trigger: 'asc' },
        });
    }

    public async clearCommandMappings(
        guildId: string,
        scope: 'server' | 'user',
        userId: string
    ): Promise<number> {
        const result = await this.prisma.commandMapping.deleteMany({ where: { guildId, scope, userId } });
        return result.count;
    }

    public async getCommandAlias(
        guildId: string,
        alias: string,
        userId: string
    ): Promise<CommandAlias | null> {
        const rows = await this.prisma.commandAlias.findMany({
            where: {
                guildId,
                alias,
                OR: [{ scope: 'server' }, { scope: 'user', userId }],
            },
            take: 2,
        });
        return rows.find(row => row.scope === 'server') ?? rows[0] ?? null;
    }

    public async setCommandAlias(
        guildId: string,
        scope: 'server' | 'user',
        userId: string,
        alias: string,
        command: string
    ): Promise<CommandAlias> {
        return await this.prisma.commandAlias.upsert({
            where: { guildId_scope_userId_alias: { guildId, scope, userId, alias } },
            create: { guildId, scope, userId, alias, command },
            update: { command },
        });
    }

    public async deleteCommandAlias(
        guildId: string,
        scope: 'server' | 'user',
        userId: string,
        alias: string
    ): Promise<boolean> {
        const result = await this.prisma.commandAlias.deleteMany({
            where: { guildId, scope, userId, alias },
        });
        return result.count > 0;
    }

    public async listCommandAliases(guildId: string, userId: string): Promise<CommandAlias[]> {
        return await this.prisma.commandAlias.findMany({
            where: { guildId, OR: [{ scope: 'server' }, { scope: 'user', userId }] },
            orderBy: { alias: 'asc' },
        });
    }

    public async clearCommandAliases(
        guildId: string,
        scope: 'server' | 'user',
        userId: string
    ): Promise<number> {
        const result = await this.prisma.commandAlias.deleteMany({ where: { guildId, scope, userId } });
        return result.count;
    }

    public async getPermissionRules(guildId: string, command?: string): Promise<PermissionRule[]> {
        return await this.prisma.permissionRule.findMany({
            where: command ? { guildId, command } : { guildId },
            orderBy: { command: 'asc' },
        });
    }

    public async setPermissionRule(
        guildId: string,
        command: string,
        targetId: string,
        targetType: string,
        allow: boolean
    ): Promise<PermissionRule> {
        return await this.prisma.permissionRule.upsert({
            where: {
                guildId_command_targetId_targetType: { guildId, command, targetId, targetType },
            },
            create: { guildId, command, targetId, targetType, allow },
            update: { allow },
        });
    }

    public async clearPermissionRules(guildId: string, command?: string): Promise<number> {
        const result = await this.prisma.permissionRule.deleteMany({
            where: command ? { guildId, command } : { guildId },
        });
        return result.count;
    }

    public async isCommandAllowed(
        guildId: string,
        command: string,
        userId: string,
        roleIds: string[]
    ): Promise<boolean> {
        const rules = await this.getPermissionRules(guildId, command);
        if (!rules.length) return true;
        const matches = rules.filter(rule =>
            rule.targetType === 'user' ? rule.targetId === userId : roleIds.includes(rule.targetId)
        );
        if (!matches.length) return true;
        const allowed = matches.some(rule => rule.allow);
        const denied = matches.some(rule => !rule.allow);
        return allowed || !denied;
    }


    public async getDj(guildId: string): Promise<Dj | null> {
        return await this.prisma.dj.findUnique({
            where: {
                guildId,
            },
        });
    }

    public async getRoles(guildId: string): Promise<Role[]> {
        return await this.prisma.role.findMany({
            where: {
                guildId,
            },
        });
    }

    public async addRole(guildId: string, roleId: string): Promise<void> {
        await this.prisma.role.upsert({
            where: {
                guildId_roleId: {
                    guildId,
                    roleId,
                },
            },
            update: {},
            create: {
                guildId,
                roleId,
            },
        });
    }

    public async removeRole(guildId: string, roleId: string): Promise<void> {
        await this.prisma.role.delete({
            where: {
                guildId_roleId: {
                    guildId,
                    roleId,
                },
            },
        });
    }

    public async clearRoles(guildId: string): Promise<void> {
        await this.prisma.role.deleteMany({
            where: {
                guildId,
            },
        });
    }

}
