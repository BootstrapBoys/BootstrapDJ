import { ApplicationCommandOptionType } from 'discord.js';
import { Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

type LyricsProviderResult = {
    text: string;
    source: string;
};

type LrcLibResult = {
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
};

const LYRICS_CACHE_LIMIT = 100;
const LYRICS_CACHE_TTL = 10 * 60_000;
const lyricsCache = new Map<string, { at: number; result: LyricsProviderResult | null }>();

/** Strip release/audio annotations that lyrics providers do not index. */
function cleanTitle(title: string): string {
    return title
        .replace(/\[[^\]]*]|\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Timed lyrics carry [mm:ss.xx] tags; show only the words. */
function cleanLyrics(text: string): string {
    return text
        .replace(/^\[[^\]]+]\s*/gm, '')
        .replace(/^.*Contributors.*(?:Lyrics)?$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function paginateLyrics(text: string, maxChars: number = 3500): string[] {
    const pages: string[] = [];
    let page = '';
    for (const line of text.split('\n')) {
        const next = `${line}\n`;
        if (page.length + next.length > maxChars) {
            if (page.trim()) pages.push(page.trim());
            page = next;
        } else {
            page += next;
        }
    }
    if (page.trim()) pages.push(page.trim());
    return pages;
}

async function fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
        headers: { 'User-Agent': 'BootstrapDJ/4.1 (https://github.com/zebz213/BootstrapDJ)' },
        signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
}

function chooseLyrics(value: unknown): string | null {
    const result = value as LrcLibResult | null;
    if (!result) return null;
    const text = result.plainLyrics || result.syncedLyrics;
    return text && text.trim().length > 20 ? cleanLyrics(text) : null;
}

/** LRCLIB first, then the small public lyrics.ovh fallback. Cached because
 * looking up the same current track every time is wasteful and rate-limit-prone. */
async function lookupLyrics(artist: string, title: string): Promise<LyricsProviderResult | null> {
    const searchTitle = cleanTitle(title) || title;
    const key = `${artist.toLowerCase()}|${searchTitle.toLowerCase()}`;
    const cached = lyricsCache.get(key);
    if (cached && Date.now() - cached.at < LYRICS_CACHE_TTL) return cached.result;

    let result: LyricsProviderResult | null = null;
    try {
        const params = new URLSearchParams({ artist_name: artist, track_name: searchTitle });
        const direct = chooseLyrics(await fetchJson(`https://lrclib.net/api/get?${params}`));
        if (direct) result = { text: direct, source: 'LRCLIB' };
    } catch {
        // Try the search and fallback providers below.
    }

    if (!result) {
        try {
            const params = new URLSearchParams({ track_name: searchTitle, artist_name: artist });
            const search = await fetchJson(`https://lrclib.net/api/search?${params}`);
            if (Array.isArray(search)) {
                for (const entry of search) {
                    const text = chooseLyrics(entry);
                    if (text) {
                        result = { text, source: 'LRCLIB' };
                        break;
                    }
                }
            }
        } catch {
            // Fall through to lyrics.ovh.
        }
    }

    if (!result) {
        try {
            const response = await fetch(
                `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(searchTitle)}`,
                { signal: AbortSignal.timeout(6_000) }
            );
            if (response.ok) {
                const json = (await response.json()) as { lyrics?: string };
                const text = json.lyrics ? cleanLyrics(json.lyrics) : '';
                if (text.length > 20) result = { text, source: 'lyrics.ovh' };
            }
        } catch {
            result = null;
        }
    }

    if (lyricsCache.size >= LYRICS_CACHE_LIMIT) {
        const oldest = lyricsCache.keys().next().value;
        if (oldest) lyricsCache.delete(oldest);
    }
    lyricsCache.set(key, { at: Date.now(), result });
    return result;
}

export default class Lyrics extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'lyrics',
            description: {
                content: 'Shows lyrics for the current or searched song',
                examples: ['lyrics', 'lyrics NF - The Search'],
                usage: 'lyrics [song]',
            },
            category: 'music',
            aliases: ['ly', 'searchlyrics', 'findlyrics'],
            cooldown: 3,
            args: false,
            player: {
                voice: false,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            defer: true,
            options: [
                {
                    name: 'song',
                    description: 'Song to look up; defaults to the current track',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const query = args.join(' ').trim();
        let track: Track | null = null;

        if (query) {
            if (!client.queue.hasNode) {
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription('No Lavalink node is available right now.'),
                    ],
                });
            }
            track = client.utils.firstTrack(await client.queue.search(query));
            if (!track) {
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription(`No results found for **${query}**.`),
                    ],
                });
            }
        } else {
            track = client.queue.get(guild.id)?.current ?? null;
            if (!track) {
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription('Nothing is playing right now.'),
                    ],
                });
            }
        }

        const result = await lookupLyrics(track.info.author, track.info.title);
        if (!result) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(
                            `No lyrics found for **${track.info.title}** by ${track.info.author}.`
                        ),
                ],
            });
        }

        const pages = paginateLyrics(result.text).slice(0, 10);
        if (!pages.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('No lyrics found.')],
            });
        }

        const embeds = pages.map((text, index) =>
            client
                .embed()
                .setColor(client.color.main)
                .setTitle(`Lyrics: ${track.info.title}`)
                .setDescription(text)
                .setFooter({
                    text: `${result.source} • Page ${index + 1}/${pages.length}`,
                })
        );
        await client.utils.paginate(ctx, embeds);
    }
}

export { cleanLyrics, paginateLyrics };

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
