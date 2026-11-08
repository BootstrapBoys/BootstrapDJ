import type { Song } from '../Dispatcher.js';

export interface TransportHost {
    queue: Song[];
    history: Song[];
    loop: string;
    autoplay: boolean;
    seed: Song | null;
    seeds: Song[];
    stopped: boolean;
    previous: Song | null;
    pauseWhenEmpty: boolean;
    paused247: boolean;
    stopTrack(): Promise<unknown>;
    seekPlayer(time: number): Promise<unknown>;
    deleteSession(): Promise<void>;
    play(): Promise<void>;
    callPlayer(action: string, run: () => Promise<unknown>): void;
}

export function shuffleQueue(host: TransportHost): void {
    const queue = host.queue;
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    host.queue = queue;
}

export function skipTracks(host: TransportHost, skipto = 1): void {
    if (skipto > 1) {
        if (skipto > host.queue.length) {
            host.queue.length = 0;
        } else {
            host.queue.splice(0, skipto - 1);
        }
    }
    host.callPlayer('stop', () => host.stopTrack());
}

export function seekTo(host: TransportHost, time: number): void {
    host.callPlayer('seek', () => host.seekPlayer(time));
}

export function stopPlayback(host: TransportHost): void {
    host.queue.length = 0;
    host.history = [];
    host.loop = 'off';
    host.autoplay = false;
    host.seed = null;
    host.seeds = [];
    host.stopped = true;
    void host.deleteSession();
    host.callPlayer('stop', () => host.stopTrack());
}

export function previousTrack(host: TransportHost): void {
    if (!host.previous) return;
    host.queue.unshift(host.previous);
    host.callPlayer('stop', () => host.stopTrack());
}

/** A listener joined a 24/7 session after it paused at track end. */
export function resume247(host: TransportHost): void {
    host.pauseWhenEmpty = false;
    if (!host.paused247) return;
    host.paused247 = false;
    if (!host.queue.length && host.previous) host.queue.unshift(host.previous);
    if (host.queue.length) void host.play();
}
