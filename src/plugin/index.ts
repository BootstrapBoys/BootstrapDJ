import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BootstrapClient } from '../core/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default async function loadPlugins(client: BootstrapClient): Promise<void> {
    const pluginsFolder = path.join(__dirname, './plugins');
    const pluginFiles = fs.readdirSync(pluginsFolder).filter(file => file.endsWith('.js'));

    // Plugins install process-wide handlers (antiCrash). Importing them with
    // forEach(async …) let login() run first, so an early throw escaped the
    // handler it was supposed to install. Resolve them all before returning.
    await Promise.all(
        pluginFiles.map(async (file: string) => {
            const plugin = (await import(`./plugins/${file}`)).default as BotPlugin;
            if (plugin.initialize) plugin.initialize(client);
            client.logger.info(`Loaded plugin: ${plugin.name} v${plugin.version}`);
        })
    );
}

export interface BotPlugin {
    name: string;
    version: string;
    author: string;
    description?: string;
    initialize: (client: BootstrapClient) => void;
    shutdown?: (client: BootstrapClient) => void;
}
/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
