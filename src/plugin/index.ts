import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BootstrapClient } from '../core/index.js';

export interface BotPlugin {
    name: string;
    version: string;
    author: string;
    description?: string;
    initialize: (client: BootstrapClient) => void;
    shutdown?: (client: BootstrapClient) => void | Promise<void>;
}

const PLUGIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugins');

/**
 * Plugins loaded for one client, in initialize order. Shutdown runs in reverse
 * so handlers installed last are removed first.
 */
const loadedPlugins = new WeakMap<BootstrapClient, BotPlugin[]>();

/**
 * Load every compiled plugin before login; handlers must be installed first.
 * `directory` exists for tests, which compile throwaway plugins elsewhere.
 */
export default async function loadPlugins(
    client: BootstrapClient,
    directory: string = PLUGIN_DIR
): Promise<void> {
    if (loadedPlugins.has(client)) await shutdownPlugins(client);

    const files = fs
        .readdirSync(directory)
        .filter(file => file.endsWith('.js'))
        .sort();
    const loaded: BotPlugin[] = [];
    for (const file of files) {
        const plugin = (await import(pathToFileURL(path.join(directory, file)).href))
            .default as BotPlugin;
        plugin.initialize(client);
        loaded.push(plugin);
        client.logger.info(`Loaded plugin: ${plugin.name} v${plugin.version}`);
    }
    loadedPlugins.set(client, loaded);
}

/**
 * Run every plugin's teardown once. A failing plugin must not prevent the rest
 * from closing their servers and timers during a graceful shutdown.
 */
export async function shutdownPlugins(client: BootstrapClient): Promise<void> {
    const plugins = loadedPlugins.get(client);
    if (!plugins) return;
    loadedPlugins.delete(client);

    for (const plugin of [...plugins].reverse()) {
        try {
            await plugin.shutdown?.(client);
        } catch (error) {
            client.logger.error(`Plugin ${plugin.name} shutdown failed:`, error);
        }
    }
}
