import { ApplicationCommandOptionType } from 'discord.js';
import { Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

function keyOf(track: Track): string {
    if (track.info.uri) return track.info.uri;
    if (track.info.identifier && track.info.sourceName) {
        return `${track.info.sourceName}:${track.info.identifier}`;
    }
    return track.encoded;
}

export default class RemoveSong extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'removesong',
            description: {
                content: 'Removes a song from a playlist',
                examples: ['removesong <playlist> <song>'],
                usage: 'removesong <playlist> <song>',
            },
            category: 'playlist',
            aliases: ['rs'],
            cooldown: 3,
            args: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
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
                    description: 'The playlist to edit',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    autocomplete: true,
                },
                {
                    name: 'song',
                    description: 'The song to remove',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.red).setDescription(text)],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;

        const playlist = (
            ctx.isInteraction && ctx.interaction
                ? ctx.interaction.options.getString('playlist')
                : args[0]
        )?.trim();
        const query = (
            ctx.isInteraction && ctx.interaction
                ? ctx.interaction.options.getString('song')
                : args.slice(1).join(' ')
        )?.trim();

        if (!playlist || !query)
            return await this.fail(client, ctx, 'Provide a playlist and a song.');

        const data = await client.db.getPLaylist(author.id, playlist);
        if (!data) return await this.fail(client, ctx, "That playlist doesn't exist.");
        if (!client.queue.hasNode) {
            return await this.fail(client, ctx, 'No Lavalink node is available right now.');
        }

        const track = client.utils.firstTrack(
            await client.queue.search(query, await resolveSearchEngine(client, ctx))
        );
        if (!track) return await this.fail(client, ctx, `No results found for **${query}**.`);

        const label = `[${track.info.title}](${track.info.uri})`;
        const removed = await client.db.removeSong(author.id, data.name, keyOf(track));
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(removed ? client.color.green : client.color.red)
                    .setDescription(
                        removed
                            ? `Removed ${label} from **${data.name}**.`
                            : `${label} is not in **${data.name}**.`
                    ),
            ],
        });
    }
}
