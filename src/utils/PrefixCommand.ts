export interface PrefixMatch {
    prefix: string;
    name: string;
}

/** Match the longest configured prefix and return the command token. */
export function matchPrefixCommand(
    content: string,
    prefixes: readonly string[]
): PrefixMatch | null {
    for (const prefix of [...new Set(prefixes.filter(Boolean))].sort((a, b) => b.length - a.length)) {
        if (!content.startsWith(prefix)) continue;
        const [name] = content.slice(prefix.length).trim().split(/ +/);
        if (!name) return null;
        return { prefix, name: name.toLowerCase() };
    }
    return null;
}
