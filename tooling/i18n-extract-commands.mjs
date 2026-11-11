import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/commands');
const LOCALES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../locales');
const fakeClient = { config: {}, logger: {} };
const metadata = {};

for (const dir of fs.readdirSync(ROOT)) {
    const folder = path.join(ROOT, dir);
    if (!fs.statSync(folder).isDirectory()) continue;
    for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.js'))) {
        const CommandClass = (await import(`../dist/commands/${dir}/${file}`)).default;
        const command = new CommandClass(fakeClient);
        const options = {};
        for (const option of command.options ?? []) {
            if (option.description) options[option.name] = option.description;
        }
        metadata[command.name] = {
            description: command.description.content,
            ...(Object.keys(options).length ? { options } : {}),
        };
    }
}

for (const language of fs.readdirSync(LOCALES)) {
    const file = path.join(LOCALES, language, 'commands.json');
    if (!fs.existsSync(file)) continue;
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    catalog.metadata = metadata;
    fs.writeFileSync(file, `${JSON.stringify(catalog, null, 4)}\n`);
}

console.log(`wrote metadata for ${Object.keys(metadata).length} commands`);
