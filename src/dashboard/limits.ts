/** Per signed-in user; test-only overrides must not affect production defaults. */
export function maxAudioStreamsPerUser(
    value: string | undefined = process.env.DASHBOARD_MAX_AUDIO_STREAMS_PER_USER
): number {
    const configured = Number(value ?? 1);
    return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : 1;
}
