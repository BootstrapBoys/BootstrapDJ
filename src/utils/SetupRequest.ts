/**
 * Setup/song-request channels normally treat every message as a search query.
 * Recognise an explicit play-next prefix so that command still jumps the queue
 * while ordinary requests keep their append-only behaviour.
 */
export function parseSetupRequest(
    content: string,
    prefixes: readonly string[],
    resolveCommand: (name: string) => string | undefined
): { query: string; next: boolean } {
    const text = content.trim();
    for (const prefix of [...prefixes].filter(Boolean).sort((a, b) => b.length - a.length)) {
        if (!text.startsWith(prefix)) continue;
        const rest = text.slice(prefix.length).trim();
        const [head, ...tail] = rest.split(/ +/);
        if (head && (head.toLowerCase() === 'playnext' || resolveCommand(head.toLowerCase()) === 'playnext')) {
            return { query: tail.join(' '), next: true };
        }
    }
    return { query: text, next: false };
}
