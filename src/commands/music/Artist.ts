import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { resolveSearchEngine } from '../../lib/SearchEngine.js';

export default class Artist extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'artist',
            description: { content: 'Looks up an artist or queues their top result', usage: 'artist <name>', examples: ['artist NF'] },
            category: 'music',
            aliases: ['artistsearch', 'artistinfo'],
            cooldown: 3,
            args: true,
            defer: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                { name: 'name', description: 'Artist name', type: ApplicationCommandOptionType.String, required: true },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const query = args.join(' ').trim();
        if (!query) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Provide an artist name.')],
            });
        }
        const res = await client.queue.search(query, await resolveSearchEngine(client, ctx));
        const track = client.utils.firstTrack(res);
        if (!track) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription(`No artist results for **${query}**.`)],
            });
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(track.info.author)
                    .setDescription(
                        `**Top result:** [${track.info.title}](${track.info.uri})\n**Duration:** ${track.info.isStream ? 'LIVE' : client.utils.formatTime(track.info.length)}\n**Source:** ${track.info.sourceName}`
                    ),
            ],
        });
    }
}
