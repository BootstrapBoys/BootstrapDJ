import config from '../config.js';
import type {
    AccessResult,
    ActionError,
    DashboardGuild,
    FilterResult,
    PlayerSnapshot,
} from './shardApi.js';
import { SettingValidationError } from './state.js';
import { type DashboardHost, DashboardRemoteError, type DashboardUserIdentity } from './host.js';

type JsonRecord = Record<string, unknown>;

/** Dashboard sidecar backend: authenticated loopback calls into the bot. */
export class RemoteDashboardHost implements DashboardHost {
    public readonly config = { icons: config.icons };
    public readonly logger = {
        error: (message: string): void => console.error(message),
        warn: (message: string): void => console.warn(message),
        info: (message: string): void => console.info(message),
    };
    private readonly baseUrl: string;
    private readonly secret: string;

    public constructor(port: number, secret: string) {
        this.baseUrl = `http://127.0.0.1:${port}`;
        this.secret = secret;
    }

    private async request<T>(
        method: string,
        path: string,
        body?: JsonRecord,
        allowValidationError: boolean = false
    ): Promise<T> {
        const response = await fetch(this.baseUrl + path, {
            method,
            headers: {
                'content-type': 'application/json',
                'x-bootstrap-control': this.secret,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
        }).catch(error => {
            throw new DashboardRemoteError(
                `dashboard control unavailable: ${error instanceof Error ? error.message : String(error)}`,
                503
            );
        });

        const raw = await response.text();
        if (!response.ok) {
            let message = raw || `dashboard control returned ${response.status}`;
            try {
                const parsed: unknown = JSON.parse(raw);
                if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
                    const value = Reflect.get(parsed, 'error');
                    if (typeof value === 'string') message = value;
                }
            } catch {
                // Keep the raw response text for non-JSON errors.
            }
            if (allowValidationError && response.status === 400) {
                throw new SettingValidationError(message);
            }
            throw new DashboardRemoteError(message, response.status);
        }

        if (!raw) return undefined as T;
        return JSON.parse(raw) as T;
    }

    public async guilds(userId: string | null): Promise<DashboardGuild[]> {
        const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
        return await this.request<DashboardGuild[]>('GET', `/internal/guilds${query}`);
    }

    public async guildIds(): Promise<string[]> {
        return await this.request<string[]>('GET', '/internal/guild-ids');
    }

    public async access(userId: string | null, guildId: string): Promise<AccessResult> {
        const query = new URLSearchParams({ guildId });
        if (userId) query.set('userId', userId);
        return await this.request<AccessResult>('GET', `/internal/access?${query.toString()}`);
    }

    public async player(
        guildId: string
    ): Promise<{ found: boolean; player: PlayerSnapshot | null }> {
        return await this.request('GET', `/internal/player?guildId=${encodeURIComponent(guildId)}`);
    }

    public async playerAction(
        guildId: string,
        action: string,
        value: number
    ): Promise<ActionError> {
        return await this.request<ActionError>('POST', '/internal/player', {
            guildId,
            action,
            value,
        });
    }

    public async filter(
        guildId: string,
        id: string,
        enabled: boolean,
        value?: number
    ): Promise<FilterResult> {
        return await this.request<FilterResult>('POST', '/internal/filter', {
            guildId,
            filter: id,
            enabled,
            ...(value === undefined ? {} : { value }),
        });
    }

    public async settings(guildId: string): Promise<Record<string, string>> {
        return await this.request<Record<string, string>>(
            'GET',
            `/internal/settings?guildId=${encodeURIComponent(guildId)}`
        );
    }

    public async saveSettings(guildId: string, values: Record<string, string>): Promise<void> {
        await this.request<{ ok: boolean }>(
            'POST',
            '/internal/settings',
            { guildId, values },
            true
        );
    }

    public async userStats(guildId: string, userId: string): Promise<unknown> {
        const query = new URLSearchParams({ guildId, userId });
        return await this.request<unknown>('GET', `/internal/me/stats?${query.toString()}`);
    }

    public async stats(guildId: string, days: number): Promise<Record<string, unknown>> {
        const query = new URLSearchParams({ guildId, days: String(days) });
        return await this.request<Record<string, unknown>>(
            'GET',
            `/internal/stats?${query.toString()}`
        );
    }

    public async clearStats(guildId: string): Promise<number> {
        const result = await this.request<{ removed: number }>('POST', '/internal/stats/clear', {
            guildId,
        });
        return result.removed;
    }

    public async metrics(): Promise<Record<string, unknown>> {
        return await this.request<Record<string, unknown>>('GET', '/internal/metrics');
    }

    public async user(userId: string): Promise<DashboardUserIdentity | null> {
        return await this.request<DashboardUserIdentity | null>(
            'GET',
            `/internal/user?id=${encodeURIComponent(userId)}`
        );
    }
}
