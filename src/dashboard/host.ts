import type {
    AccessResult,
    ActionError,
    DashboardGuild,
    FilterResult,
    PlayerSnapshot,
} from './shardApi.js';

export type DashboardUserIdentity = {
    name: string;
    avatar: string | null;
};

/**
 * Everything the dashboard routes need from the bot.
 *
 * `embedded` mode implements this over the live BootstrapClient. `sidecar`
 * mode implements the same contract over an authenticated loopback control
 * API, so the HTTP process can be restarted without touching voice/Discord.
 */
export interface DashboardHost {
    readonly config: { icons: Record<string, string> };
    readonly logger: {
        error(message: string): void;
        warn(message: string): void;
        info(message: string): void;
    };
    guilds(userId: string | null): Promise<DashboardGuild[]>;
    guildIds(): Promise<string[]>;
    access(userId: string | null, guildId: string): Promise<AccessResult>;
    player(guildId: string): Promise<{ found: boolean; player: PlayerSnapshot | null }>;
    playerAction(guildId: string, action: string, value: number): Promise<ActionError>;
    filter(guildId: string, id: string, enabled: boolean, value?: number): Promise<FilterResult>;
    settings(guildId: string): Promise<Record<string, string>>;
    saveSettings(guildId: string, values: Record<string, string>): Promise<void>;
    userStats(guildId: string, userId: string): Promise<unknown>;
    stats(guildId: string, days: number): Promise<Record<string, unknown>>;
    clearStats(guildId: string): Promise<number>;
    metrics(): Promise<Record<string, unknown>>;
    user(userId: string): Promise<DashboardUserIdentity | null>;
}

/** Error returned by the dashboard sidecar's loopback control client. */
export class DashboardRemoteError extends Error {
    public readonly status: number;

    public constructor(message: string, status: number = 502) {
        super(message);
        this.name = 'DashboardRemoteError';
        this.status = status;
    }
}
