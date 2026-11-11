import { ApplicationCommandOptionType } from 'discord.js';
import { Track } from 'shoukaku';

import { BootstrapClient, Command, Context, Song } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { getPlayLimits, queueHasRoom } from '../../lib/PlayLimits.js';

type StoredRow = Awaited<ReturnType<BootstrapClient['db']['getSong']>>[number];

/** Rows written before the per-track fix hold an array in one row. */
function rowTracks(row: StoredRow): Array<Song | Track> | null {
    try {
        const parsed: unknown = JSON.parse(row.track);
        return (Array.isArray(parsed) ? parsed : [parsed]) as Array<Song | Track>;
    } catch {
        return null;
    }
}

export default class Load extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'load',
            description: {
                content: 'Loads a playlist',
                examples: ['load <playlist>'],
                usage: 'load <playlist>',
            },
            category: 'playlist',
            aliases: [],
            cooldown: 3,
            args: true,
            player: { voice: true, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            defer: true,
            options: [
                {
                    name: 'playlist',
                    description: 'The playlist you want to load',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true,
                },
            ],
        });
    }

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:manage.load.${key}`, variables);
    }

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({ embeds: [{ description: text, color: client.color.red }] });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const name = args.join(' ').trim();

        const playlist = await client.db.getPLaylist(author.id, name);
        if (!playlist) return await this.fail(client, ctx, this.copy(ctx, 'notExist'));

        const rows = await client.db.getSong(author.id, name);
        if (rows.length === 0) return await this.fail(client, ctx, this.copy(ctx, 'empty'));

        let player = client.queue.get(guild.id);
        if (!player || player.isStale)
            player = await client.queue.create(guild, ctx.voiceChannel, ctx.channel);
        const limits = await getPlayLimits(client, guild.id);

        const queued: Song[] = [];
        let skipped = 0;
        for (const row of rows) {
            const entries = rowTracks(row);
            if (!entries) {
                skipped += 1;
                continue;
            }
            for (const entry of entries) {
                if (!queueHasRoom(player, limits)) {
                    skipped += 1;
                    continue;
                }
                const song = player.buildTrack(entry, author);
                player.enqueue(song, false, false);
                queued.push(song);
            }
        }

        player.seedPlaylist(queued);
        await player.isPlaying();
        return await ctx.sendMessage({
            embeds: [
                {
                    description: this.copy(ctx, skipped > 0 ? 'loadedSkipped' : 'loaded', {
                        name: playlist.name,
                        count: queued.length,
                        skipped,
                    }),
                    color: client.color.main,
                },
            ],
        });
    }
}
