/**
 * Lavalink search prefixes. These strings are part of the Lavalink REST
 * protocol, so they are values rather than display labels.
 */
export const SearchEngine = {
    YouTube: 'ytsearch',
    SoundCloud: 'scsearch',
    YouTubeMusic: 'ytmsearch',
} as const;

export type SearchEngine = (typeof SearchEngine)[keyof typeof SearchEngine];

/** Body accepted by the Earl control bridge. */
export interface EarlCommandBody {
    guildId?: string;
    voiceChannelId?: string;
    textChannelId?: string;
    userId?: string;
    text?: string;
}

export interface EarlCommandResult {
    status: number;
    message: string;
}

export type EarlCommandHandler = (body: EarlCommandBody) => Promise<EarlCommandResult>;
export type EarlSetupRefresher = (guildId: string) => Promise<void>;
