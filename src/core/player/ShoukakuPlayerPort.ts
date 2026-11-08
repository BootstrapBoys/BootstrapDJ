import type { Player } from 'shoukaku';

import type { Song } from '../Dispatcher.js';
import type { PlaybackPlayerPort } from './PlaybackEngine.js';

/**
 * Adapts Shoukaku's Player to the narrow playback port. The player is resolved
 * lazily because a dispatcher may be constructed around a player that is later
 * replaced during a node migration.
 */
export class ShoukakuPlayerPort implements PlaybackPlayerPort {
    public constructor(private readonly resolvePlayer: () => Player) {}

    private get player(): Player {
        return this.resolvePlayer();
    }

    public isAvailable(): boolean {
        return Boolean(this.player);
    }

    public async play(track: Song): Promise<void> {
        await this.player.playTrack({ track: { encoded: track.encoded } });
    }

    public async pause(): Promise<void> {
        await this.player.setPaused(true);
    }

    public async resume(): Promise<void> {
        await this.player.setPaused(false);
    }

    public async seek(positionMs: number): Promise<void> {
        await this.player.seekTo(positionMs);
    }

    public async stop(): Promise<void> {
        await this.player.stopTrack();
    }

    public async setVolume(volume: number): Promise<void> {
        await this.player.setGlobalVolume(volume);
    }

    public position(): number {
        return this.player.position;
    }

    public volume(): number {
        return this.player.volume;
    }

    public isPaused(): boolean {
        return this.player.paused;
    }

    public hasTrack(): boolean {
        return Boolean(this.player.track);
    }
}
