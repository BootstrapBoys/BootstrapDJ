import { ShardingManager } from 'discord.js';
import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';

import config from './config.js';
import Logger from './structures/Logger.js';
import { loadBots } from './utils/BotsFile.js';

const logger = new Logger();

if (!fs.existsSync('./src/utils/LavaLogo.txt')) {
    logger.error('LavaLogo.txt file is missing');
    process.exit(1);
}

try {
    const logFile = fs.readFileSync('./src/utils/LavaLogo.txt', 'utf-8');
    console.log('\x1b[35m%s\x1b[0m', logFile);
} catch (err) {
    logger.error('[CLIENT] An error has occurred :', err);
}
const bots = config.botsFile ? loadBots(config.botsFile) : [];
if (bots.length) {
    logger.start(`[CLIENT] launching ${bots.length} bot process(es) from ${config.botsFile}`);
    const launch = (bot: (typeof bots)[number], index: number): void => {
        const child = fork(path.resolve('dist/ShardClient.js'), [], {
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
            setTimeout(() => launch(bot, index), 5000);
        });
    };
    bots.forEach((bot, index) => launch(bot, index));
} else {
    const manager = new ShardingManager('./dist/ShardClient.js', {
        respawn: true,
        token: config.token,
        totalShards: config.shardCount > 0 ? config.shardCount : 'auto',
        shardList: 'auto',
    });

    manager
        .spawn({ amount: manager.totalShards, delay: undefined, timeout: -1 })
        .then(shards => {
            logger.start(`[CLIENT] ${shards.size} shard(s) spawned.`);
        })
        .catch(err => {
            logger.error('[CLIENT] An error has occurred :', err);
        });

    manager.on('shardCreate', shard => {
        shard.on('ready', () => {
            logger.start(`[CLIENT] Shard ${shard.id} connected to Discord's Gateway.`);
        });
    });
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
