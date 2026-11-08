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
