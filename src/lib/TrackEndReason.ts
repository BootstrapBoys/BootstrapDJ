/** Lavalink has emitted both `finished` and `FINISHED` across versions. Loop
 * modes must requeue only on a natural end, never on STOPPED/REPLACED. */
export function isFinishedTrackReason(reason: unknown): boolean {
    return typeof reason === 'string' && reason.toUpperCase() === 'FINISHED';
}
