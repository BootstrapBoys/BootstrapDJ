/**
 * Slash replies are private by default, but a guild can opt into public
 * "normal message" replies. Prefix replies are always normal messages, so
 * this policy is only consulted on the interaction path.
 */
export function shouldReplyEphemeral(
    commandEphemeral: boolean,
    settings: Record<string, string>
): boolean {
    return settings.ephemeral === 'false' ? false : commandEphemeral;
}

/**
 * Guild auto-delete override. `0` is a real value ("never auto-delete"), not
 * "unset"; only a missing or malformed setting falls back to the global config.
 */
export function deleteAfterSeconds(settings: Record<string, string>): number | null {
    const raw = settings.deleteafter;
    if (raw === undefined || raw === null || raw.trim() === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
