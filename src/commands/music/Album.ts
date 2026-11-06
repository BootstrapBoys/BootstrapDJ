import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { resolveSearchEngine } from '../../utils/SearchEngine.js';

export default class Album extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'album',
            description: { content: 'Looks up an album or queues its first result', usage: 'album <name>', examples: ['album The Search'] },
            category: 'music',
            aliases: ['albumsearch', 'albuminfo'],
            cooldown: 3,
            args: true,
            defer: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                { name: 'name', description: 'Album name', type: ApplicationCommandOptionType.String, required: true },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const query = args.join(' ').trim();
        if (!query) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Provide an album name.')],
            });
        }
        const res = await client.queue.search(`album ${query}`, await resolveSearchEngine(client, ctx));
        const track = client.utils.firstTrack(res);
        if (!track) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription(`No album results for **${query}**.`)],
            });
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(track.info.title)
                    .setURL(track.info.uri ?? null)
                    .setDescription(
                        `**Artist:** ${track.info.author}\n**Duration:** ${track.info.isStream ? 'LIVE' : client.utils.formatTime(track.info.length)}\n**Source:** ${track.info.sourceName}`
                    ),
            ],
        });
    }
}
