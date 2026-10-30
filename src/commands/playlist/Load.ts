import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Load extends Command {
    constructor(client: BootstrapClient) {
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
            player: {
                voice: true,
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
                    name: 'playlist',
                    description: 'The playlist you want to load',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true,
                },
            ],
        });
    }
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        let player = client.queue.get(guild.id);
        const playlist = args.join(' ').trim();
        const playlistData = await client.db.getPLaylist(author.id, playlist);
        if (!playlistData)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'That playlist doesn\'t exist',
                        color: client.color.red,
                    },
                ],
            });
        const songs = await client.db.getSong(author.id, playlist);
        if (!songs.length)
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: 'That playlist is empty',
                        color: client.color.red,
                    },
                ],
            });
        if (!player) {
            const vc = ctx.voiceChannel;
            player = await client.queue.create(guild, vc, ctx.channel);
        }

        let loaded = 0;
        let skipped = 0;
        for (const row of songs) {
            let parsed: any;
            try {
                parsed = JSON.parse(row.track);
            } catch {
                skipped++;
                continue;
            }
            // Rows written before the per-track fix hold an array in one row.
            const tracks: any[] = Array.isArray(parsed) ? parsed : [parsed];
            for (const entry of tracks) {
                if (player.queue.length >= client.config.maxQueueSize) {
                    skipped++;
                    continue;
                }
                player.enqueue(player.buildTrack(entry, author));
                loaded++;
            }
        }

        await player.isPlaying();
        await ctx.sendMessage({
            embeds: [
                {
                    description: `Loaded \`${playlistData.name}\` with \`${loaded}\` songs${
                        skipped ? ` (${skipped} skipped)` : ''
                    }`,
                    color: client.color.main,
                },
            ],
        });
    }
}
