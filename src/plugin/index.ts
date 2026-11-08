import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BootstrapClient } from '../core/index.js';

export interface BotPlugin {
    name: string;
    version: string;
    author: string;
    description?: string;
    initialize: (client: BootstrapClient) => void;
    shutdown?: (client: BootstrapClient) => void;
}

const PLUGIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugins');

/** Load every compiled plugin before login; handlers must be installed first. */
export default async function loadPlugins(client: BootstrapClient): Promise<void> {
    const files = fs.readdirSync(PLUGIN_DIR).filter(file => file.endsWith('.js'));
    await Promise.all(
        files.map(async file => {
            const plugin = (await import(`./plugins/${file}`)).default as BotPlugin;
            plugin.initialize(client);
            client.logger.info(`Loaded plugin: ${plugin.name} v${plugin.version}`);
        })
    );
}
