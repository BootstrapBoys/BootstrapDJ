import type { LoopMode, PlaybackSessionPort } from './PlaybackEngine.js';
import { persistSession } from './SessionWriter.js';
import type { Song } from '../Dispatcher.js';

interface SessionStore {
    saveSession(session: {
        guildId: string;
        textId: string;
        voiceId: string;
        current: string | null;
        queue: string;
        loop: string;
        autoplay: boolean;
        volume: number;
        paused: boolean;
    }): Promise<void>;
    deleteSession(guildId: string): Promise<void>;
}

/** Adapts the session data store; the snapshot writer stays in SessionWriter. */
export class SessionPort implements PlaybackSessionPort {
    public constructor(private readonly db: SessionStore) {}

    public async save(snapshot: {
        guildId: string;
        textId: string;
        voiceId: string;
        current: Song | null;
        queue: Song[];
        position: number;
        loop: LoopMode;
        autoplay: boolean;
        volume: number;
        paused: boolean;
    }): Promise<void> {
        await persistSession(this.db, snapshot);
    }

    public async remove(guildId: string): Promise<void> {
        // Deletion is best-effort: a missing row or busy database must not
        // surface as an unhandled rejection from a fire-and-forget stop().
        await this.db.deleteSession(guildId).catch(() => {});
    }
}
