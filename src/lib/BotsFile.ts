import fs from 'node:fs';

export type BotDefinition = {
    name: string;
    clientId: string;
    token: string;
    enabled: boolean;
    priority: number;
};

type BotsFile = {
    bots?: Array<Partial<BotDefinition>>;
    preferredOrder?: string[];
};

export function loadBots(path: string): BotDefinition[] {
    if (!path) return [];
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8')) as BotsFile;
    const order = new Map((parsed.preferredOrder ?? []).map((name, index) => [name, index]));
    return (parsed.bots ?? [])
        .filter(bot => bot.enabled !== false && bot.name && bot.token && bot.clientId)
        .map((bot, index) => ({
            name: String(bot.name),
            clientId: String(bot.clientId),
            token: String(bot.token),
            enabled: bot.enabled !== false,
            priority: order.get(String(bot.name)) ?? Number(bot.priority ?? index + 1),
        }))
        .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}
