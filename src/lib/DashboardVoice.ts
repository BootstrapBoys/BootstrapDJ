import type { BootstrapClient } from '../core/index.js';

/** Per-guild dashboard voice channel, falling back to the legacy env value. */
export async function resolveDashboardVoiceChannelId(
    client: BootstrapClient,
    guildId: string
): Promise<string> {
    try {
        const settings = await client.db.getGuildSettings(guildId);
        const configured = (settings.dashboardvoicechannel ?? '').trim();
        if (configured) return configured;
    } catch {
        // Fall through to the host-level fallback when settings are unavailable.
    }
    return (client.config.dashboardVoiceChannelId ?? '').trim();
}

/** Sync form used by existing player objects during cleanup and voice events. */
export function dashboardVoiceChannelIdFor(
    client: BootstrapClient,
    player?: { dashboardVoiceChannelId?: string | null } | null
): string {
    const configured = (player?.dashboardVoiceChannelId ?? '').trim();
    return configured || (client.config.dashboardVoiceChannelId ?? '').trim();
}
