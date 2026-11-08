import { ShardingManager } from 'discord.js';
import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';

import config from './config.js';
import Logger from './core/Logger.js';
import { loadBots } from './lib/BotsFile.js';
import type { BotDefinition } from './lib/BotsFile.js';

const logger = new Logger();
const CHILD_ENTRY = path.resolve('dist/ShardClient.js');
const RESTART_DELAY_MS = 5_000;

/** The banner is part of the operator's first impression; keep it fatal if absent. */
function printBanner(): void {
    const resource = path.resolve('src/lib/LavaLogo.txt');
    if (!fs.existsSync(resource)) {
        logger.error('LavaLogo.txt file is missing');
        process.exit(1);
    }
    try {
        console.log('\x1b[35m%s\x1b[0m', fs.readFileSync(resource, 'utf-8'));
    } catch (error) {
        logger.error('[CLIENT] An error has occurred :', error);
    }
}

/** One process per bot, with a fresh token and its own bridge/dashboard ports. */
function launchBot(bot: BotDefinition, index: number): void {
    const child = fork(CHILD_ENTRY, [], {
        env: {
            ...process.env,
            BOT_TOKEN: bot.token,
            BOT_NAME: bot.name,
            BOT_ID: bot.clientId,
            BOT_PRIORITY: String(bot.priority),
            BOT_COORDINATOR: index === 0 ? 'true' : 'false',
            DASHBOARD_PORT: index === 0 ? process.env.DASHBOARD_PORT || '0' : '0',
            VOICE_BRIDGE_PORT: String(config.voiceBridgePort + index * 5),
        },
        stdio: 'inherit',
    });
    child.on('exit', code => {
        logger.error(`[CLIENT] ${bot.name} exited (${code ?? 'signal'}); restarting in 5s`);
        setTimeout(() => launchBot(bot, index), RESTART_DELAY_MS);
    });
}

function launchFleet(bots: BotDefinition[]): void {
    logger.start(`[CLIENT] launching ${bots.length} bot process(es) from ${config.botsFile}`);
    for (const [index, bot] of bots.entries()) launchBot(bot, index);
}

function launchShards(): void {
    const manager = new ShardingManager(CHILD_ENTRY, {
        respawn: true,
        token: config.token,
        totalShards: config.shardCount > 0 ? config.shardCount : 'auto',
        shardList: 'auto',
    });
    manager
        .spawn({ amount: manager.totalShards, delay: undefined, timeout: -1 })
        .then(shards => logger.start(`[CLIENT] ${shards.size} shard(s) spawned.`))
        .catch(error => logger.error('[CLIENT] An error has occurred :', error));
    manager.on('shardCreate', shard => {
        shard.on('ready', () =>
            logger.start(`[CLIENT] Shard ${shard.id} connected to Discord's Gateway.`)
        );
    });
}

printBanner();

const fleet = config.botsFile ? loadBots(config.botsFile) : [];
if (fleet.length > 0) launchFleet(fleet);
else launchShards();
