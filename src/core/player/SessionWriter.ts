import { incrementCounter } from '../../lib/PerformanceCounters.js';
import type { Song } from '../Dispatcher.js';
import { toSaved } from './TrackCodec.js';

export interface SessionSnapshot {
    guildId: string;
    textId: string;
    voiceId: string;
    current: Song | null;
    queue: Song[];
    position: number;
    loop: string;
    autoplay: boolean;
    volume: number;
    paused: boolean;
}

interface SessionWriter {
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

/** Persist a live snapshot, or remove the row when there is nothing to restore. */
export async function persistSession(db: SessionWriter, snapshot: SessionSnapshot): Promise<void> {
    if (!snapshot.current && !snapshot.queue.length) {
        await db.deleteSession(snapshot.guildId);
        return;
    }
    const payload = {
        guildId: snapshot.guildId,
        textId: snapshot.textId,
        voiceId: snapshot.voiceId,
        current: snapshot.current
            ? JSON.stringify({ ...toSaved(snapshot.current), position: snapshot.position })
            : null,
        queue: JSON.stringify(snapshot.queue.map(toSaved)),
        loop: snapshot.loop,
        autoplay: snapshot.autoplay,
        volume: snapshot.volume,
        paused: snapshot.paused,
    };
    incrementCounter('sessionWrites');
    incrementCounter('sessionBytes', (payload.current?.length ?? 0) + payload.queue.length);
    await db.saveSession(payload);
}
