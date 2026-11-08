import type { BootstrapClient, Event } from '../core/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../events');

type EventClass = new (client: BootstrapClient, file: string) => Event;

async function register(client: BootstrapClient, dir: string, file: string): Promise<void> {
    const module = await import(`../events/${dir}/${file}`);
    const EventClass = module.default as EventClass;
    const event = new EventClass(client, file);
    const dispatch = (...args: unknown[]): void => {
        void Promise.resolve()
            .then(() => event.run(...args))
            .catch(error => client.logger.error(`[event] ${event.name} failed: ${error}`));
    };
    if (dir === 'player') {
        client.shoukaku.on(event.name as Parameters<typeof client.shoukaku.on>[0], dispatch);
    } else {
        client.on(event.name, dispatch);
    }
}

/** Register every event before login so a fast gateway connect cannot beat us. */
export async function installEvents(client: BootstrapClient): Promise<void> {
    const pending: Array<Promise<void>> = [];
    for (const dir of fs.readdirSync(ROOT)) {
        const files = fs
            .readdirSync(path.join(ROOT, dir))
            .filter(file => file.endsWith('.js'));
        for (const file of files) pending.push(register(client, dir, file));
    }
    await Promise.all(pending);
}
