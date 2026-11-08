import type { BootstrapClient } from '../index.js';
import { restoreSession } from './SessionRestorer.js';

const LEASE_TTL_MS = 60_000;
const HANDOFF_INTERVAL_MS = 10_000;
const handoffStarted = new WeakSet<BootstrapClient>();

/**
 * Refresh the lease for every player this process owns, and adopt a saved
 * session whose owner has stopped heartbeating. The database claim is atomic,
 * so two standby bots cannot both take the same guild.
 */
export function startSessionHandoffs(client: BootstrapClient): void {
    if (handoffStarted.has(client)) return;
    handoffStarted.add(client);
    const tick = (): void => {
        void handoffTick(client).catch(error =>
            client.logger.warn(`[lease] handoff check failed: ${error}`)
        );
    };
    const initial = setTimeout(tick, 5_000);
    const timer = setInterval(tick, HANDOFF_INTERVAL_MS);
    (initial as unknown as { unref?: () => void }).unref?.();
    (timer as unknown as { unref?: () => void }).unref?.();
}

async function handoffTick(client: BootstrapClient): Promise<void> {
    const botUser = client.user;
    if (!botUser) return;
    const botName = client.config.botName || botUser.username;

    for (const guildId of Array.from(client.queue.keys())) {
        const refreshed = await client.db
            .claimSessionLease(guildId, botUser.id, botName, LEASE_TTL_MS)
            .catch(() => false);
        if (refreshed) continue;
        const lease = await client.db.getSessionLease(guildId).catch(() => null);
        if (lease && lease.expiresAt.getTime() > Date.now() && lease.botId !== botUser.id) {
            // Another process won the guild. Stop the local player without
            // deleting the saved session so exactly one bot produces audio.
            client.logger.warn(`[lease] ${guildId} owned by ${lease.botName}; yielding local player`);
            client.queue.get(guildId)?.destroy(true);
        } else {
            client.logger.warn(`[lease] could not refresh ${guildId}`);
        }
    }

    const sessionGuildIds = await client.db.getSessionGuildIds();
    for (const guildId of sessionGuildIds) {
        if (!client.guilds.cache.has(guildId)) continue;
        if (client.queue.has(guildId)) continue;
        const now = Date.now();
        const lease = await client.db.getSessionLease(guildId).catch(() => null);
        if (lease && lease.expiresAt.getTime() > now) {
            // This includes our own lease: a restore in progress already owns
            // the guild before its dispatcher appears in the queue map.
            continue;
        }

        // When there is no lease at all, preserve preferred-bot ordering. An
        // expired lease means the owner is gone, so any standby may race for it
        // and the database transaction picks exactly one winner.
        if (!lease) {
            // Only the priority-0 child may adopt an unleased row. During boot
            // it can still be waiting for Lavalink while lower-priority
            // watchdogs start; those children must not steal the saved session
            // before the first restore claims it.
            if (!client.shard && client.config.botPriority > 0) continue;
            const preferred = await client.preferredBotStatus(guildId);
            if (!preferred.allowed) continue;
        }

        const claimed = await client.db.claimSessionLease(
            guildId,
            botUser.id,
            botName,
            LEASE_TTL_MS
        );
        if (!claimed) continue;
        client.logger.info(
            `[lease] ${botUser.username} claimed ${guildId} (priority ${client.config.botPriority})`
        );
        const session = await client.db.getSession(guildId).catch(() => null);
        if (!session) {
            await client.db.releaseSessionLease(guildId, botUser.id).catch(() => {});
            continue;
        }
        try {
            await restoreSession(client, session, botUser);
        } catch (error) {
            client.logger.error(`[lease] takeover failed for ${guildId}: ${error}`);
        } finally {
            if (!client.queue.has(guildId)) {
                await client.db.releaseSessionLease(guildId, botUser.id).catch(() => {});
            }
        }
    }
}
