export enum SearchEngine {
    YouTube = 'ytsearch',
    SoundCloud = 'scsearch',
    YouTubeMusic = 'ytmsearch',
}

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
