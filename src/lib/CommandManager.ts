import type Command from '../core/Command.js';
import type { BootstrapClient } from '../core/index.js';
import {
    ApplicationCommandType,
    Events,
    PermissionsBitField,
    REST,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    Routes,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../commands');
export type SlashBody = RESTPostAPIChatInputApplicationCommandsJSONBody;
type SlashRoute = ReturnType<typeof Routes.applicationCommands>;

function directories(): string[] {
    return fs.readdirSync(ROOT);
}

function commandFiles(dir: string): string[] {
    return fs.readdirSync(path.join(ROOT, dir)).filter(file => file.endsWith('.js'));
}

async function register(
    client: BootstrapClient,
    dir: string,
    file: string,
    bust: boolean
): Promise<SlashBody | null> {
    const module = await import(`../commands/${dir}/${file}${bust ? `?update=${Date.now()}` : ''}`);
    const CommandClass = module.default as new (client: BootstrapClient) => Command;
    const command = new CommandClass(client);
    command.category = dir;
    client.commands.set(command.name, command);
    for (const alias of command.aliases) client.aliases.set(alias, command.name);
    if (!command.slashCommand) return null;

    const body: SlashBody = {
        name: command.name,
        description: command.description.content ?? command.name,
        type: ApplicationCommandType.ChatInput,
        ...(command.options.length ? { options: command.options as SlashBody['options'] } : {}),
        ...(command.nameLocalizations ? { name_localizations: command.nameLocalizations } : {}),
        ...(command.descriptionLocalizations
            ? { description_localizations: command.descriptionLocalizations }
            : {}),
    };
    if (command.permissions.user.length) {
        const value = PermissionsBitField.resolve(command.permissions.user);
        body.default_member_permissions = typeof value === 'bigint' ? value.toString() : value;
    }
    return body;
}

export async function installCommands(
    client: BootstrapClient,
    bust: boolean = false
): Promise<SlashBody[]> {
    client.commands.clear();
    client.aliases.clear();
    const pending: Array<Promise<SlashBody | null>> = [];
    for (const dir of directories()) {
        for (const file of commandFiles(dir)) pending.push(register(client, dir, file, bust));
    }
    const bodies = await Promise.all(pending);
    return bodies.filter((body): body is SlashBody => body !== null);
}

function registrationRoutes(client: BootstrapClient, userId: string): SlashRoute[] {
    const shardedNonCoordinator = Boolean(client.shard) && !client.isCoordinator;
    if (client.config.production === true) {
        return shardedNonCoordinator ? [] : [Routes.applicationCommands(userId)];
    }
    return [...client.guilds.cache.keys()].map(guildId =>
        Routes.applicationGuildCommands(userId, guildId)
    );
}

export function attachSlashPublisher(client: BootstrapClient, body: SlashBody[]): void {
    client.once(Events.ClientReady, async () => {
        const userId = client.user?.id;
        if (!userId) return;
        const shardedNonCoordinator = Boolean(client.shard) && !client.isCoordinator;
        const routes = registrationRoutes(client, userId);
        if (!client.config.production && !routes.length && !shardedNonCoordinator) {
            if (client.guilds.cache.has(client.config.guildId)) {
                routes.push(Routes.applicationGuildCommands(userId, client.config.guildId));
            }
        }
        if (!routes.length) {
            if (shardedNonCoordinator)
                client.logger.info('[slash] no command routes for this shard');
            return;
        }
        const payload = body.slice(0, 100);
        if (body.length > 100) {
            client.logger.error(
                `[slash] ${body.length} commands exceed Discord's 100-command limit; only the first 100 will register.`
            );
        }
        try {
            const rest = new REST({ version: '10' }).setToken(client.config.token ?? '');
            if (client.config.production !== true && (!client.shard || client.isCoordinator)) {
                const globalRoute = Routes.applicationCommands(userId);
                const existing = (await rest.get(globalRoute)) as unknown[];
                if (Array.isArray(existing) && existing.length) {
                    await rest.put(globalRoute, { body: [] });
                    client.logger.info(`[slash] cleared ${existing.length} stale global commands`);
                }
            }
            for (const route of routes) await rest.put(route, { body: payload });
            client.logger.info(`Successfully loaded slash commands in ${routes.length} guild(s)!`);
        } catch (error) {
            client.logger.error(error);
        }
    });
}
